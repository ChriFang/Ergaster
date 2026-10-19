import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback, type FormEvent, type KeyboardEvent } from 'react';
import type { AppInfo } from '../shared/contracts';
import { buildCodeConversationScope, type CodeProjectListItem } from '../shared/code-project';
import type { McpServerListItem } from '../shared/mcp';
import type { WorkflowDefinitionListItem } from '../shared/workflow-definition';
import { AgentsPanel } from './features/agents/AgentsPanel';
import { BotMarkIcon } from './features/layout/BotMarkIcon';
import { ConsolePanel } from './features/layout/ConsolePanel';
import { DEFAULT_AGENT_ID } from '../shared/agent-profile';
import { SettingsDialogShell } from './features/layout/SettingsDialogShell';
import { ExtensionsCatalogPanel } from './features/settings/extensions/ExtensionsCatalogPanel';
import { findExtensionCatalogItem } from './features/settings/extensions/extension-catalog';
import { parseExtensionTab } from './lib/types/app-shell';
import { SidebarPanel, type SidebarTab } from './features/layout/SidebarPanel';
import { McpServersPanel } from './features/mcp/McpServersPanel';
import { SettingsPanel } from './features/settings/SettingsPanel';
import { ToolsSettingsPanel } from './features/settings/ToolsSettingsPanel';
import { normalizeConfigForm } from './features/settings/settings-model';
import { SkillsPanel } from './features/skills/SkillsPanel';
import { WorkflowsPanel } from './features/workflows/WorkflowsPanel';
import { desktopAppClient } from './lib/desktop/desktop-app-client';
import { useAppBootstrap } from './lib/hooks/use-app-bootstrap';
import { useChatSession } from './lib/hooks/use-chat-session';
import { useComposerState } from './lib/hooks/use-composer-state';
import { useConversationDrafts } from './lib/hooks/use-conversation-drafts';
import { useContextMenu } from './lib/hooks/use-context-menu';
import { useSettingsState } from './lib/hooks/use-settings-state';
import { useWorkflowSession } from './lib/hooks/use-workflow-session';
import { parseCodeProjectIdFromScope } from './lib/utils/last-active-session';


/** 距底部小于该像素数即视为“贴底”，用于粘性跟随判定。 */
const STICK_TO_BOTTOM_THRESHOLD_PX = 80;

export function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const chatScrollAreaRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingComposerFocusRef = useRef(false);

  // 是否处于“贴底跟随”状态：用户滚到底部附近为 true，向上翻阅为 false。
  // 内容高度异步增长（图片解码、iframe 撑开、后台切回前台补涨）时据此决定是否重新贴底。
  const stickToBottomRef = useRef(true);

  const requestChatScrollToBottom = useCallback(() => {
    stickToBottomRef.current = true;
  }, []);

  const {
    settingsDialogState,
    setSettingsDialogState,
    openSettingsDialog,
    closeSettingsDialog,
    config,
    setConfig,
    formValues,
    setFormValues,
    showApiKey,
    setShowApiKey,
    showGithubToken,
    setShowGithubToken,
    updateToolSettings,
    saveStatus,
    autoSaveConfig,
    changeConfigAndSave,
    commitModelConnection,
    handleThinkingModeChange,
    handleCloseActionChange,
    handleModelReasoningEffortChange,
    addExtension,
    removeExtension,
    availableModels,
    modelsLoading,
    modelsError,
    selectModel,
    refreshModels,
    allowedPathsText,
    setAllowedPathsText,
    searchRootsText,
    setSearchRootsText,
    commandAllowlistText,
    setCommandAllowlistText,
    commandDenylistText,
    setCommandDenylistText,
    downloadAllowedHostsText,
    setDownloadAllowedHostsText,
    draftDirectoryText,
  } = useSettingsState();

  const {
    input,
    setInput,
    handleInputChange,
    handleComposerKeyDown,
  } = useComposerState();

  const {
    messages,
    attachments,
    setAttachments,
    runStatus,
    setRunStatus,
    isRunning,
    hasAnyRunning,
    runningConversationIds,
    confirmationRequest,
    lastError,
    expandedToolMessageKeys,
    agents,
    setAgents,
    availableSkills,
    selectedAgentId,
    selectedAgent,
    selectedCodeProjectId,
    handleCodeProjectSelection,
    activeStreamAgentIdRef,
    activeConversationId,
    setActiveConversationId,
    conversationList,
    unreadSummary,
    isCreatingConversation,
    activeConversationTitle,
    refreshConversationList,
    handleSelectConversation,
    handleCreateConversation,
    handleDeleteConversation,
    handleRenameConversation,
    handleUndoFromMessage,
    loadConversationMessages,
    loadOlderConversationMessages,
    hasMoreMessagesBefore,
    isLoadingOlderMessages,
    handleAgentSelection,
    restoreLastActiveSession,
    handleToggleToolMessage,
    handleRunAgent,
    handleCancelAgent,
    handleResetAgent,
    handleAgentsChanged,
    handleToolConfirmation,
    visibleMessages,
    showRunningActivityPanel,
    showErrorActivityPanel,
    applyStreamDelta,
    applyConfirmationRequest,
    ensureConversationBucket,
    filePreviews,
    uiWidgets,
    toolInvocations,
    handleUiFormSubmit,
    handleUiHtmlPopOut,
    handleUiHtmlReclaim,
  } = useChatSession({
    input,
    setInput,
    onRequestScrollToBottom: requestChatScrollToBottom,
  });

  // 未发送的输入与附件按会话隔离：切换会话时暂存/载入各自草稿，避免草稿跨会话残留
  useConversationDrafts({ activeConversationId, input, setInput, attachments, setAttachments });

  const {
    mode,
    activeRun,
    activeRunIdRef,
    workflowArtifacts,
    selectedWorkflowType,
    selectedCustomWorkflowId,
    isWorkflowRunning,
    lastWorkflowError,
    isExportingReport,
    reportExportNotice,
    exportWorkflowReport,
    loadWorkflowRuns,
    startWorkflow,
    cancelWorkflow,
    startCustomWorkflow,
    selectChatMode,
    selectCodeMode,
    selectBuiltInWorkflow,
    selectCustomWorkflow,
    applyWorkflowStream,
  } = useWorkflowSession({ input, setInput });

  const [workflows, setWorkflows] = useState<WorkflowDefinitionListItem[]>([]);
  const [codeProjects, setCodeProjects] = useState<CodeProjectListItem[]>([]);
  const [availableMcpServers, setAvailableMcpServers] = useState<McpServerListItem[]>([]);
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>('agents');
  /** 当前展开会话列表的 scope：智能体 id 或 code:{projectId}；null 表示全部收起。 */
  const [expandedScopeKey, setExpandedScopeKey] = useState<string | null>(null);

  const reloadCodeProjects = useCallback(async () => {
    try {
      const list = await desktopAppClient.listCodeProjects();
      setCodeProjects(list);
      return list;
    } catch {
      return [] as CodeProjectListItem[];
    }
  }, []);

  useEffect(() => {
    void reloadCodeProjects();
    // MCP 服务清单给 Code 模式的绑定浮层用；加载失败按空清单处理，不阻断界面
    void desktopAppClient.listMcpServers().then(setAvailableMcpServers).catch(() => {});
  }, [reloadCodeProjects]);

  const selectedCodeProject = useMemo(
    () => codeProjects.find((project) => project.id === selectedCodeProjectId) ?? null,
    [codeProjects, selectedCodeProjectId],
  );

  const reloadWorkflows = useCallback(async () => {
    try {
      const list = await desktopAppClient.listWorkflows();
      setWorkflows(list);
    } catch {
      // 列表加载失败时保持现状，不阻断 UI
    }
  }, []);

  const {
    contextMenuState,
    copyText,
    handleCopySelection,
    handleMessageContextMenu,
    handleConversationBlankContextMenu,
    handleResetConversation,
  } = useContextMenu(chatScrollAreaRef, setRunStatus, handleResetAgent);

  useAppBootstrap({

    setAppInfo,
    setConfig,
    setFormValues,
    setShowApiKey,
    normalizeConfigForm,
    refreshModels,
    ensureDefaultConversation: async () => {
      // 先尝试恢复上次激活的会话（重启后回到用户离开时的现场）
      const restored = await restoreLastActiveSession();
      if (restored) {
        // 同步侧边栏展开态/顶部模式/侧边栏 Tab，让恢复出的 scope 与 UI 一致
        const codeProjectId = parseCodeProjectIdFromScope(restored.scope);
        if (codeProjectId) {
          setActiveSidebarTab('code');
          setExpandedScopeKey(buildCodeConversationScope(codeProjectId));
          selectCodeMode();
        } else {
          setActiveSidebarTab('agents');
          setExpandedScopeKey(restored.scope ?? DEFAULT_AGENT_ID);
          selectChatMode();
        }
        return;
      }

      // 无可恢复记录：回退到默认智能体的最近会话（原行为）
      // 复用 refreshConversationList：同时填充侧边栏会话列表与头部会话标题
      const conversations = await refreshConversationList(DEFAULT_AGENT_ID);
      if (conversations.length > 0) {
        ensureConversationBucket(conversations[0].id);
        setActiveConversationId(conversations[0].id);
        await loadConversationMessages(conversations[0].id);
      } else {
        const meta = await desktopAppClient.createConversation(DEFAULT_AGENT_ID);
        ensureConversationBucket(meta.id);
        setActiveConversationId(meta.id);
        await refreshConversationList(DEFAULT_AGENT_ID);
      }
    },
    setAgents,
    applyConfirmationRequest,
    onRequestScrollToBottom: requestChatScrollToBottom,
    activeStreamAgentIdRef,
    applyStreamDelta,
    loadWorkflowRuns,
    reloadWorkflows,
    activeRunIdRef,
    applyWorkflowStream,
  });


  const statusText = useMemo(() => {
    if (!appInfo) {
      return '正在加载应用信息...';
    }

    return `${appInfo.name} v${appInfo.version}`;
  }, [appInfo]);

  const shouldShowTitlebarTitle = appInfo?.platform !== 'darwin';
  const handleCopyMessage = useCallback((text: string) => {
    void copyText(text, '已复制完整消息内容。');
  }, [copyText]);

  const handleUndoMessageClick = useCallback(
    async (messageId: string) => {
      if (!activeConversationId) {
        return;
      }
      const ok = await desktopAppClient.confirmDialog({
        message: '确定撤销这条消息及其后的所有内容吗？',
        detail: '此操作不可恢复。',
        confirmText: '撤销',
      });
      if (ok) {
        void handleUndoFromMessage(activeConversationId, messageId);
      }
    },
    [activeConversationId, handleUndoFromMessage],
  );

  // 消息/确认态变化后，若仍处于贴底状态则贴到底部（同步内容的即时跟随）。
  useLayoutEffect(() => {
    const container = chatScrollAreaRef.current;
    if (!container || !stickToBottomRef.current) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [visibleMessages, confirmationRequest, activeRun?.messages]);

  // 粘性贴底：跟随用户滚动位置更新贴底状态；用 ResizeObserver 观察滚动内容，
  // 高度异步增长（图片解码、render_ui iframe 撑开、后台切回前台的补涨）时，
  // 只要仍处于贴底状态就重新贴到底部，避免视口停在某条历史消息上。
  useEffect(() => {
    const container = chatScrollAreaRef.current;
    if (!container) {
      return;
    }

    const updateStick = () => {
      const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      stickToBottomRef.current = distanceToBottom <= STICK_TO_BOTTOM_THRESHOLD_PX;
    };
    const pinIfSticky = () => {
      if (stickToBottomRef.current) {
        container.scrollTop = container.scrollHeight;
      }
    };

    container.addEventListener('scroll', updateStick, { passive: true });

    const content = container.firstElementChild;
    const observer = content ? new ResizeObserver(pinIfSticky) : null;
    if (content && observer) {
      observer.observe(content);
    }

    return () => {
      container.removeEventListener('scroll', updateStick);
      observer?.disconnect();
    };
  }, [mode, activeConversationId]);

  function focusComposerInput(options?: { keepPending?: boolean }) {
    const inputElement = composerInputRef.current;
    if (!inputElement) {
      pendingComposerFocusRef.current = true;
      return;
    }

    inputElement.focus();
    if (!options?.keepPending) {
      pendingComposerFocusRef.current = false;
    }
  }

  useEffect(() => {
    if (pendingComposerFocusRef.current && !isRunning && !isWorkflowRunning) {
      requestAnimationFrame(() => focusComposerInput());
    }

  }, [isRunning, isWorkflowRunning]);

  async function handleLoadOlderMessages() {
    const container = chatScrollAreaRef.current;
    if (!container) {
      void loadOlderConversationMessages();
      return;
    }

    const previousScrollHeight = container.scrollHeight;
    const previousScrollTop = container.scrollTop;
    const loaded = await loadOlderConversationMessages();
    if (!loaded) {
      return;
    }

    requestAnimationFrame(() => {
      const nextContainer = chatScrollAreaRef.current;
      if (!nextContainer) {
        return;
      }
      nextContainer.scrollTop = nextContainer.scrollHeight - previousScrollHeight + previousScrollTop;
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    pendingComposerFocusRef.current = true;
    requestAnimationFrame(() => focusComposerInput({ keepPending: true }));

    const runTask = mode === 'workflow'
      ? selectedWorkflowType === 'custom' && selectedCustomWorkflowId
        ? startCustomWorkflow(selectedCustomWorkflowId, input)
        : startWorkflow(selectedWorkflowType === 'deep_research' ? 'deep_research' : 'debate')
      : handleRunAgent();

    void runTask.finally(() => requestAnimationFrame(() => focusComposerInput()));

  }

  // 运行中切换模式/工作流的二次确认：返回 true 表示可以继续切换
  async function confirmSwitchWhileRunning(): Promise<boolean> {
    if (!isWorkflowRunning) {
      return true;
    }
    return desktopAppClient.confirmDialog({
      message: '当前有工作流正在运行，切换后将中断该运行。是否继续？',
      confirmText: '继续切换',
    });
  }

  async function handleSelectAgent(agentId: string | null) {
    const nextAgentId = agentId ?? DEFAULT_AGENT_ID;
    if (mode === 'chat' && nextAgentId === selectedAgentId) {
      // 再次点击同一智能体：仅展开/收起会话列表，不重新切换会话
      setExpandedScopeKey((current) => (current === nextAgentId ? null : nextAgentId));
      return;
    }
    if (!(await confirmSwitchWhileRunning())) {
      return;
    }
    if (isWorkflowRunning) {
      void cancelWorkflow();
    }
    setExpandedScopeKey(nextAgentId);
    void handleAgentSelection(nextAgentId);
    selectChatMode();
  }

  async function handleSelectBuiltInWorkflow(type: 'debate' | 'deep_research') {
    if (mode === 'workflow' && selectedWorkflowType === type && selectedCustomWorkflowId === null) {
      return;
    }
    if (!(await confirmSwitchWhileRunning())) {
      return;
    }
    if (isWorkflowRunning) {
      void cancelWorkflow();
    }
    selectBuiltInWorkflow(type);
  }

  async function handleSelectCodeProject(projectId: string) {
    if (mode === 'code' && projectId === selectedCodeProjectId) {
      // 再次点击同一工程：仅展开/收起会话列表，不重新切换会话
      const scopeKey = buildCodeConversationScope(projectId);
      setExpandedScopeKey((current) => (current === scopeKey ? null : scopeKey));
      return;
    }
    if (!(await confirmSwitchWhileRunning())) {
      return;
    }
    if (isWorkflowRunning) {
      void cancelWorkflow();
    }
    setExpandedScopeKey(buildCodeConversationScope(projectId));
    void handleCodeProjectSelection(projectId);
    selectCodeMode();
  }

  async function handleImportCodeProject() {
    const result = await desktopAppClient.importCodeProject();
    if (result.cancelled) {
      return;
    }

    if (!result.ok || !result.data) {
      void desktopAppClient.alertDialog({ message: result.error ?? '导入代码工程失败。' });
      return;
    }

    await reloadCodeProjects();
    if (result.warning) {
      void desktopAppClient.alertDialog({ message: result.warning });
    }
    handleSelectCodeProject(result.data.id);
  }

  async function handleToggleCodeProjectWritable(writable: boolean) {
    if (!selectedCodeProjectId) {
      return;
    }

    // 开启写权限是提权操作，需要用户明确二次确认
    if (writable) {
      const ok = await desktopAppClient.confirmDialog({
        message: '开启后智能体可以新建与修改该工程内的文件。每次写入仍会弹出 diff 让你确认，原文件也会自动备份。是否继续？',
        confirmText: '开启',
      });
      if (!ok) {
        return;
      }
    }

    const result = await desktopAppClient.setCodeProjectWritable(selectedCodeProjectId, writable);
    if (!result.ok) {
      void desktopAppClient.alertDialog({ message: result.error ?? '更新工程写权限失败。' });
      return;
    }

    await reloadCodeProjects();
  }

  async function handleToggleCodeProjectMcpServer(serverName: string, enabled: boolean) {
    if (!selectedCodeProject) {
      return;
    }

    const nextNames = enabled
      ? Array.from(new Set([...selectedCodeProject.mcp.enabledServerNames, serverName]))
      : selectedCodeProject.mcp.enabledServerNames.filter((name) => name !== serverName);

    const result = await desktopAppClient.setCodeProjectMcpBinding(selectedCodeProject.id, nextNames);
    if (!result.ok) {
      void desktopAppClient.alertDialog({ message: result.error ?? '更新工程 MCP 绑定失败。' });
      return;
    }

    await reloadCodeProjects();
  }

  async function handleRemoveCodeProject(projectId: string, projectName: string) {
    const ok = await desktopAppClient.confirmDialog({
      message: `确定从应用中移除工程「${projectName}」吗？`,
      detail: '磁盘上的工程文件不会被删除；该工程下的会话历史会被一并清理，且无法恢复。',
      confirmText: '移除',
    });
    if (!ok) {
      return;
    }

    const result = await desktopAppClient.removeCodeProject(projectId);
    if (!result.ok) {
      void desktopAppClient.alertDialog({ message: result.error ?? '移除代码工程失败。' });
      return;
    }

    await reloadCodeProjects();
    const removedScopeKey = buildCodeConversationScope(projectId);
    // 移除的是展开会话列表的工程时，收起列表避免展示已清空的会话
    if (expandedScopeKey === removedScopeKey) {
      setExpandedScopeKey(null);
    }

    // 删除的是当前选中的工程时，切回该 Tab 下剩余的工程（若有），
    // 停留在 Code Tab；一个工程都不剩才退回默认智能体
    if (projectId === selectedCodeProjectId) {
      const remaining = codeProjects.filter((project) => project.id !== projectId);
      if (remaining.length > 0) {
        void handleCodeProjectSelection(remaining[0].id);
        return;
      }

      setExpandedScopeKey(DEFAULT_AGENT_ID);
      void handleAgentSelection(DEFAULT_AGENT_ID);
      selectChatMode();
      setActiveSidebarTab('agents');
    }
  }

  async function handleSelectCustomWorkflow(workflowId: string) {
    if (mode === 'workflow' && selectedWorkflowType === 'custom' && selectedCustomWorkflowId === workflowId) {
      return;
    }
    if (!(await confirmSwitchWhileRunning())) {
      return;
    }
    if (isWorkflowRunning) {
      void cancelWorkflow();
    }
    selectCustomWorkflow(workflowId);
  }

  function handleComposerKeyDownWithRunningState(event: KeyboardEvent<HTMLTextAreaElement>) {
    handleComposerKeyDown(event, mode === 'workflow' ? isWorkflowRunning : isRunning);
  }


  return (
    <div className="app-root">
      <div className="app-titlebar" role="banner">
        {shouldShowTitlebarTitle ? <span className="app-titlebar-title">{appInfo?.name ?? 'Ergaster'}</span> : null}
      </div>
      <div className="app-shell">
      <SidebarPanel
        agents={agents}
        selectedAgentId={selectedAgentId}
        workflows={workflows}
        selectedWorkflowType={selectedWorkflowType}
        selectedCustomWorkflowId={selectedCustomWorkflowId}
        codeProjects={codeProjects}
        selectedCodeProjectId={selectedCodeProjectId}
        mode={mode}
        activeTab={activeSidebarTab}
        expandedScopeKey={expandedScopeKey}
        conversations={conversationList}
        unreadSummary={unreadSummary}
        activeConversationId={activeConversationId}
        isRunning={isRunning}
        runningConversationIds={runningConversationIds}
        isCreatingConversation={isCreatingConversation}
        onTabChange={setActiveSidebarTab}
        onSelectAgent={handleSelectAgent}
        onSelectConversation={(conversationId) => {
          void handleSelectConversation(conversationId);
        }}
        onCreateConversation={() => {
          void handleCreateConversation();
        }}
        onDeleteConversation={async (conversationId, conversationTitle) => {
          const ok = await desktopAppClient.confirmDialog({
            message: `确定删除会话「${conversationTitle}」吗？`,
            detail: '该会话的聊天记录会被一并删除，且无法恢复。',
            confirmText: '删除',
          });
          if (ok) {
            void handleDeleteConversation(conversationId);
          }
        }}
        onRenameConversation={(conversationId, title) => {
          void handleRenameConversation(conversationId, title);
        }}
        onCreateAgent={() => openSettingsDialog('agents', true)}
        onOpenAgentSettings={(agentId) => openSettingsDialog('agents', false, agentId)}
        onSelectBuiltInWorkflow={handleSelectBuiltInWorkflow}
        onSelectCustomWorkflow={handleSelectCustomWorkflow}
        onCreateWorkflow={() => openSettingsDialog('workflow', true)}
        onSelectCodeProject={handleSelectCodeProject}
        onImportCodeProject={() => {
          void handleImportCodeProject();
        }}
        onRemoveCodeProject={handleRemoveCodeProject}
        onOpenSettings={() => openSettingsDialog('general')}
      />

      <ConsolePanel
        mode={mode}
        selectedAgent={selectedAgent}
        codeProject={selectedCodeProject}
        conversationTitle={activeConversationTitle}
        activeConversationId={activeConversationId}
        onToggleCodeProjectWritable={(writable) => {
          void handleToggleCodeProjectWritable(writable);
        }}
        availableMcpServers={availableMcpServers}
        onToggleCodeProjectMcpServer={(serverName, enabled) => {
          void handleToggleCodeProjectMcpServer(serverName, enabled);
        }}
        visibleMessages={visibleMessages}
        activeRun={activeRun}
        workflowArtifacts={workflowArtifacts}
        availableSkills={availableSkills}
        selectedWorkflowType={selectedWorkflowType}
        workflows={workflows}
        selectedCustomWorkflowId={selectedCustomWorkflowId}
        expandedToolMessageKeys={expandedToolMessageKeys}
        filePreviews={filePreviews}
        uiWidgets={uiWidgets}
        toolInvocations={toolInvocations}
        onUiFormSubmit={handleUiFormSubmit}
        onUiHtmlPopOut={handleUiHtmlPopOut}
        onUiHtmlReclaim={handleUiHtmlReclaim}

        onToggleToolMessage={handleToggleToolMessage}
        onCopyMessage={handleCopyMessage}
        onUndoFromMessage={handleUndoMessageClick}
        onMessageContextMenu={handleMessageContextMenu}
        onConversationBlankContextMenu={handleConversationBlankContextMenu}
        contextMenuState={contextMenuState}
        onCopySelection={() => {
          void handleCopySelection();
        }}
        onResetConversation={() => {
          void handleResetConversation();
        }}
        chatScrollAreaRef={chatScrollAreaRef}
        composerInputRef={composerInputRef}
        hasMoreMessagesBefore={hasMoreMessagesBefore}
        isLoadingOlderMessages={isLoadingOlderMessages}
        onLoadOlderMessages={() => {
          void handleLoadOlderMessages();
        }}
        showRunningActivityPanel={showRunningActivityPanel}
        showErrorActivityPanel={showErrorActivityPanel}
        isRunning={isRunning}
        isWorkflowRunning={isWorkflowRunning}
        lastError={lastError}
        lastWorkflowError={lastWorkflowError}
        isExportingReport={isExportingReport}
        reportExportNotice={reportExportNotice}
        onExportReport={() => {
          void exportWorkflowReport();
        }}
        onOpenPath={(targetPath) => {
          void desktopAppClient.openPath(targetPath);
        }}
        confirmationRequest={confirmationRequest}

        onRejectConfirmation={() => {
          void handleToolConfirmation(false);
        }}
        onApproveConfirmation={(autoRun, autoAllowCommand, autoAllowDomain) => {
          void handleToolConfirmation(true, autoRun, autoAllowCommand, autoAllowDomain);
        }}
        input={input}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        thinkingModeEnabled={formValues.thinkingModeEnabled}
        availableModels={availableModels}
        selectedModel={formValues.model}
        modelsLoading={modelsLoading}
        modelsError={modelsError}
        onModelChange={selectModel}
        onRefreshModels={refreshModels}
        onInputChange={handleInputChange}
        onSubmit={handleSubmit}
        onCancel={() => {
          if (mode === 'workflow') {
            void cancelWorkflow();
            return;
          }
          void handleCancelAgent();
        }}

        onThinkingModeChange={(value) => {
          void handleThinkingModeChange(value);
        }}
        reasoningEffortByModel={formValues.reasoningEffortByModel}
        onModelReasoningEffortChange={(model, effort) => {
          void handleModelReasoningEffortChange(model, effort);
        }}
        onKeyDown={handleComposerKeyDownWithRunningState}
      />


      <SettingsDialogShell
        open={settingsDialogState.open}
        activeTab={settingsDialogState.tab}
        enabledExtensions={formValues.enabledExtensions}
        onClose={() => {
          closeSettingsDialog();
          void reloadWorkflows();
        }}
        onTabChange={(tab) => {
          setSettingsDialogState({ open: true, tab });
        }}
        onRemoveExtension={(id) => {
          void removeExtension(id);
        }}
        renderContent={(tab) => {
          const extensionId = parseExtensionTab(tab);
          if (extensionId) {
            const item = findExtensionCatalogItem(extensionId);
            // 扩展已从目录移除或 id 失配：回退到目录视图而不是白屏
            if (!item) {
              return <ExtensionsCatalogPanel enabledExtensions={formValues.enabledExtensions} onAdd={(id) => void addExtension(id)} />;
            }
            const Panel = item.Panel;
            return <Panel onClose={closeSettingsDialog} />;
          }
          switch (tab) {
            case 'extensions':
              return <ExtensionsCatalogPanel enabledExtensions={formValues.enabledExtensions} onAdd={(id) => void addExtension(id)} />;
            case 'agents':
              return <AgentsPanel onClose={closeSettingsDialog} onAgentsChanged={handleAgentsChanged} startCreating={settingsDialogState.create} initialAgentId={settingsDialogState.agentId} />;
            case 'skills':
              return <SkillsPanel onClose={closeSettingsDialog} />;
            case 'mcp':
              return <McpServersPanel onClose={closeSettingsDialog} />;
            case 'workflow':
              return (
                <WorkflowsPanel
                  onClose={closeSettingsDialog}
                  startCreating={settingsDialogState.create}
                  onRunWorkflow={(workflowId, seedPrompt) => {
                    closeSettingsDialog();
                    selectCustomWorkflow(workflowId);
                    void startCustomWorkflow(workflowId, seedPrompt);
                  }}
                />
              );
            case 'about':
              return (
                <section className="about-panel">
                  <div className="about-panel-card about-panel-card-brand">
                    <div className="about-panel-main">
                      <div className="about-panel-logo" aria-hidden="true">
                        <BotMarkIcon size={30} />
                      </div>
                      <h3>{appInfo?.name ?? 'Ergaster'}</h3>
                      <p className="about-panel-version">{statusText}</p>
                      <p className="about-panel-description">
                        面向本地桌面工作流的智能体控制台，支持多轮对话、工具调用审批、自定义 Skills 与 MCP 服务管理。
                      </p>
                    </div>
                    <p className="about-panel-copyright">© 2026 Ergaster. All rights reserved.</p>
                  </div>
                </section>
              );
            case 'tools':
              return (
                <ToolsSettingsPanel
                  formValues={formValues}
                  commandAllowlistText={commandAllowlistText}
                  commandDenylistText={commandDenylistText}
                  downloadAllowedHostsText={downloadAllowedHostsText}
                  allowedPathsText={allowedPathsText}
                  searchRootsText={searchRootsText}
                  draftDirectoryText={draftDirectoryText}
                  saveStatus={saveStatus}
                  onChange={setFormValues}
                  onAutoSave={autoSaveConfig}
                  onToggle={changeConfigAndSave}
                  onCommandAllowlistChange={setCommandAllowlistText}
                  onCommandDenylistChange={setCommandDenylistText}
                  onDownloadAllowedHostsChange={setDownloadAllowedHostsText}
                  onAllowedPathsChange={setAllowedPathsText}
                  onSearchRootsChange={setSearchRootsText}
                  onDraftDirectoryChange={(value) => {
                    setFormValues((current) => ({
                      ...current,
                      toolSettings: {
                        ...current.toolSettings,
                        draftDirectory: value,
                      },
                    }));
                  }}
                />
              );
            case 'general':
            default:
              return (
                <SettingsPanel
                  config={config}
                  formValues={formValues}
                  showApiKey={showApiKey}
                  showGithubToken={showGithubToken}
                  saveStatus={saveStatus}
                  onToggleShowApiKey={() => setShowApiKey((value) => !value)}
                  onToggleShowGithubToken={() => setShowGithubToken((value) => !value)}
                  onChange={setFormValues}
                  onAutoSave={autoSaveConfig}
                  onToggle={changeConfigAndSave}
                  onModelConnectionCommit={commitModelConnection}
                  onCloseActionChange={(value) => {
                    void handleCloseActionChange(value);
                  }}
                />
              );
          }
        }}
      />
      </div>
    </div>
  );
}
