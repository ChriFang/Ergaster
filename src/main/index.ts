import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, session, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { agentService } from './agent/agent-service';
import { registerConfirmationHandlers } from './tools/confirmation-service';
import { appendCommandAllowlist, appendDownloadAllowedHost } from './core/config-service';
import { registerToolCatalogHandlers } from './tools/tool-catalog-handlers';
import { registerSkillHandlers } from './skills/skill-handlers';
import { userSkillsService } from './skills/user-skills-service';
import { registerAgentProfileHandlers } from './agent-profiles/agent-profile-handlers';
import { registerCodeProjectHandlers } from './code/code-project-handlers';
import { registerWorkflowDefinitionHandlers } from './workflow/workflow-definition-handlers';
import { loadUserSkills } from './tools/tool-registry';
import { getMaskedConfig, loadConfig, saveConfig } from './core/config-service';
import { listAvailableModels } from './core/model-service';
import { agentProfilesService } from './agent-profiles/agent-profiles-service';
import { codeProjectsService } from './code/code-projects-service';
import { workflowDefinitionsService } from './workflow/workflow-definitions-service';
import { registerMcpHandlers } from './mcp/mcp-handlers';
import { initializeCapabilities } from './capabilities/capability-registry';
import { registerConversationHandlers } from './conversation/conversation-handlers';
import { registerAttachmentHandlers } from './conversation/attachment-handlers';
import { conversationService } from './conversation/conversation-service';
import { memoryService } from './memory/memory-service';
import { registerScheduledTaskHandlers } from './scheduler/scheduled-task-handlers';
import { scheduledTaskService } from './scheduler/scheduled-task-service';
import { schedulerRunner } from './scheduler/scheduler-runner';
import { registerUiWindowHandlers } from './ui-window/ui-window-manager';
import type { AppInfo } from '../shared/contracts';
import type { AgentStreamEvent } from '../shared/agent';
import type { ExportWorkflowReportResponse, WorkflowStreamEvent } from '../shared/workflow';
import { workflowService } from './workflow/workflow-service';
import { buildWorkflowReportFileName, buildWorkflowReportMarkdown } from './workflow/workflow-report';
import { appendMainLog } from './core/audit-log';
import { clipLogText } from './tools/tool-helpers';
import { resolveCloseBehavior } from '../shared/config';
import { createTray, initTrayService, showMainWindow } from './tray/tray-service';


const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

// 单实例锁：最小化到托盘后用户重新双击图标时唤起已有窗口，而不是双开
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
}
initTrayService(() => mainWindow, createMainWindow);

// 强制深色主题：让 Windows 等平台的原生控件（select 下拉列表、滚动条等）按深色渲染，
// 避免下拉展开时出现浅灰底与深色界面冲突。标题栏单独走自定义亮白方案（见 createMainWindow）。
nativeTheme.themeSource = 'dark';

function getRendererEntryUrl() {
  if (process.env.VITE_DEV_SERVER_URL) {
    return process.env.VITE_DEV_SERVER_URL;
  }

  return `file://${path.join(__dirname, '../renderer/index.html')}`;
}

function isExternalHttpUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 会话级安全加固：拒绝 renderer 发起的 web 权限请求。
 * 这是 CVE-2026-70612 的官方缓解：沙箱 iframe 拉起外部协议依赖 openExternal 权限
 * （无 request handler 时默认放行），这里显式全拒后该路径被关闭。
 *
 * 注意：刻意不设置 setPermissionCheckHandler——Electron 对不透明 origin
 * （data:/sandbox iframe）做权限检查时会触发 site_info.cc 的
 * "Check failed: origin.GetTupleOrPrecursorTupleIfOpaque().IsValid()" 日志刷屏；
 * 本应用 renderer 不依赖任何 web 权限检查，不装即走 Electron 默认行为。
 */
function configureSessionSecurity() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

function createMainWindow() {
  const rendererEntryUrl = getRendererEntryUrl();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#111827',
    title: 'Ergaster',
    // Windows 下显式指定窗口/任务栏图标：开发模式默认是 Electron 图标。打包时
    // package-electron.mjs 会把 assets/icon.ico 拷进应用目录，app.getAppPath()
    // 在开发与打包两种环境下都指向应用根。mac 打包走 assets/icon.icns，这里不设。
    ...(process.platform === 'win32' ? { icon: path.join(app.getAppPath(), 'assets', 'icon.ico') } : {}),
    // 隐藏系统标题栏，由渲染层绘制亮白标题条；titleBarOverlay 保留原生最小/最大/关闭按钮（白底深色符号）
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#ffffff',
      symbolColor: '#1f2937',
      height: 32,
    },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.removeMenu();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) {
      void shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url === rendererEntryUrl) {
      return;
    }

    if (isExternalHttpUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  // 渲染进程崩溃（整窗空白的主要来源）必须落盘，否则只能看到一块底色
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    void appendMainLog('ERROR', `Renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`);
  });

  void mainWindow.loadURL(rendererEntryUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Windows 下点关闭按钮按配置决定去向；mac 保持平台默认（关窗不退出）
  if (process.platform === 'win32') {
    mainWindow.on('close', (event) => {
      if (isQuitting) {
        return;
      }

      // preventDefault 必须同步调用（await 之后无效），之后异步读配置决定去向
      event.preventDefault();
      void handleWindowCloseRequest();
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function handleWindowCloseRequest() {
  const win = mainWindow;
  if (!win || win.isDestroyed()) {
    return;
  }

  const config = await loadConfig();
  const behavior = resolveCloseBehavior(config.closeAction, process.platform);

  if (behavior === 'minimize') {
    win.hide();
    return;
  }

  if (behavior === 'ask') {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['最小化到托盘', '退出', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      message: '要最小化到系统托盘，还是退出程序？',
      detail: '应用可在后台继续执行任务；该选择会记住，可在 设置 → 通用设置 中修改。',
    });

    if (response === 0) {
      win.hide();
      void saveConfig({ closeAction: 'minimize' }).catch(() => appendMainLog('ERROR', '保存关闭行为失败'));
      return;
    }

    if (response === 1) {
      // 先落盘再退出，避免写文件与进程退出竞态
      await saveConfig({ closeAction: 'exit' }).catch(() => appendMainLog('ERROR', '保存关闭行为失败'));
      app.quit();
      return;
    }

    // 取消（含 Esc / 关闭弹窗）：本次不关闭、不落盘
    return;
  }

  // behavior === 'exit'：与自然关闭流程（window-all-closed → quit）等价
  isQuitting = true;
  app.quit();
}

ipcMain.handle('app:get-info', () => {
  const appInfo: AppInfo = {
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
  };

  return appInfo;
});

// 渲染层未捕获异常 / Promise 拒绝由 preload 转发到这里，抢在崩溃前留下现场
ipcMain.on('app:renderer-error', (_event, message: unknown) => {
  if (typeof message === 'string' && message.trim()) {
    void appendMainLog('ERROR', `Renderer error: ${clipLogText(message.trim(), 2000)}`);
  }
});

ipcMain.handle('config:get', async () => getMaskedConfig());

ipcMain.handle('config:save', async (_event, payload) => saveConfig(payload));

ipcMain.handle('models:list', async () => listAvailableModels(await loadConfig()));

ipcMain.handle('agent:run', async (_event, payload) => agentService.run(payload));

ipcMain.handle('agent:cancel', async () => agentService.cancel());

ipcMain.handle('agent:reset', async (_event, scope) => {
  agentService.reset(scope);
});

ipcMain.handle('agent:get-messages', async (_event, scope) => agentService.getMessages(scope));

ipcMain.handle('workflow:start-debate', async (_event, payload) => workflowService.startDebate(payload));

ipcMain.handle('workflow:start-deep-research', async (_event, payload) => workflowService.startDeepResearch(payload));

ipcMain.handle('workflow:start-custom', async (_event, payload) => workflowService.startCustomWorkflow(payload));

ipcMain.handle('workflow:get-run', async (_event, runId) => workflowService.getWorkflowRun(runId));


ipcMain.handle('workflow:list-runs', async () => workflowService.listWorkflowRuns());

ipcMain.handle('workflow:cancel-run', async (_event, runId) => workflowService.cancelWorkflow(runId));

ipcMain.handle('workflow:export-report', async (_event, runId): Promise<ExportWorkflowReportResponse> => {
  if (typeof runId !== 'string' || !runId.trim()) {
    throw new TypeError('runId must be a non-empty string.');
  }

  const run = workflowService.getWorkflowRun(runId.trim());
  if (!run) {
    throw new Error('找不到该工作流运行记录，可能已被清理。');
  }

  if (run.artifacts.length === 0) {
    throw new Error('本次运行还没有可导出的产物。');
  }

  const exportedAt = Date.now();
  const markdown = buildWorkflowReportMarkdown(run, exportedAt);
  const defaultPath = path.join(app.getPath('documents'), buildWorkflowReportFileName(run, exportedAt));

  // 由用户在系统保存对话框中选定落盘位置，因此不需要额外的目录白名单校验
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showSaveDialog(mainWindow, {
      title: '保存研究报告',
      defaultPath,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    : await dialog.showSaveDialog({
      title: '保存研究报告',
      defaultPath,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });

  if (result.canceled || !result.filePath) {
    return { saved: false };
  }

  await fs.writeFile(result.filePath, markdown, 'utf8');
  return { saved: true, filePath: result.filePath };
});

ipcMain.handle('clipboard:write-text', async (_event, text) => {

  if (typeof text !== 'string') {
    throw new TypeError('Clipboard text must be a string.');
  }

  const normalized = text.trim();
  if (!normalized) {
    throw new Error('Clipboard text cannot be empty.');
  }

  clipboard.writeText(normalized);
});

ipcMain.handle('shell:open-external', async (_event, url) => {
  if (typeof url !== 'string') {
    throw new TypeError('URL must be a string.');
  }

  const normalized = url.trim();
  if (!normalized) {
    throw new Error('URL cannot be empty.');
  }

  if (!isExternalHttpUrl(normalized)) {
    throw new Error('Only http/https URLs can be opened externally.');
  }

  await shell.openExternal(normalized);
});

// 原生确认/提示对话框：renderer 的 window.confirm/alert 会导致窗口鼠标事件失效
// （Electron 已知问题），统一改走主进程 dialog.showMessageBox。
ipcMain.handle('app:confirm', async (event, options: { message: string; detail?: string; confirmText?: string; cancelText?: string }) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  if (!target || target.isDestroyed()) {
    return false;
  }

  const result = await dialog.showMessageBox(target, {
    type: 'warning',
    buttons: [options.confirmText ?? '确定', options.cancelText ?? '取消'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    message: options.message,
    detail: options.detail,
  });
  return result.response === 0;
});

ipcMain.handle('app:alert', async (event, options: { message: string; detail?: string }) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  if (!target || target.isDestroyed()) {
    return;
  }

  await dialog.showMessageBox(target, {
    type: 'info',
    buttons: ['确定'],
    noLink: true,
    message: options.message,
    detail: options.detail,
  });
});

app.whenReady().then(async () => {
  // 未持有单实例锁的实例直接退出，不做任何初始化
  if (!hasSingleInstanceLock) {
    return;
  }

  registerConfirmationHandlers({ appendCommandAllowlist, appendDownloadAllowedHost });
  registerToolCatalogHandlers();
  registerSkillHandlers();
  registerAgentProfileHandlers();
  registerCodeProjectHandlers();
  registerWorkflowDefinitionHandlers();
  registerMcpHandlers();
  registerConversationHandlers();
  registerAttachmentHandlers();
  registerScheduledTaskHandlers();
  registerUiWindowHandlers(() => mainWindow, getRendererEntryUrl);
  await loadUserSkills();
  await agentProfilesService.scanAndLoadAgents();
  await codeProjectsService.scanAndLoadProjects();
  await workflowDefinitionsService.scanAndLoadWorkflows();
  await conversationService.scanAndLoadConversations();
  await memoryService.scanAndLoad();
  await initializeCapabilities();
  configureSessionSecurity();
  createMainWindow();

  // 托盘强制开启（仅 Windows；mac 不做托盘）
  if (process.platform === 'win32') {
    createTray();
  }

  // 会话删除后级联清理其定时任务（conversationService 不反向依赖 scheduler）
  conversationService.onConversationDeleted((conversationId) => {
    void scheduledTaskService.deleteByConversation(conversationId);
  });

  // 定时任务：加载后启动调度循环。错过的触发不补跑，加载时已前移到下一次
  await scheduledTaskService.load();
  schedulerRunner.start();

  agentService.onStream((payload: AgentStreamEvent) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.webContents.send('agent:stream', payload);
  });

  // 会话后台变更（如首轮标题生成落定）推送给 renderer 刷新会话列表
  conversationService.onConversationChanged((event) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.webContents.send('conversation:changed', event);
  });

  // Skills 集合变更（如模型经 install_skill 安装）推送给 renderer 刷新 Skills 列表
  userSkillsService.onSkillsChanged((event) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.webContents.send('skills:changed', event);
  });

  workflowService.onStream((payload: WorkflowStreamEvent) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.webContents.send('workflow:stream', payload);
  });

  app.on('activate', () => {

    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // 置位后 close 拦截放行，托盘菜单退出、弹窗退出、window-all-closed 三条路径都能穿透
  isQuitting = true;
  schedulerRunner.stop();
});
