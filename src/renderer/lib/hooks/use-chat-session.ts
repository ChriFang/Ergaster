import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AttachmentMeta } from '../../../shared/attachment';
import type { AgentMessage, AgentStreamEvent, FilePreviewPayload } from '../../../shared/agent';
import { DEFAULT_AGENT_ID, type AgentProfileListItem } from '../../../shared/agent-profile';
import { buildCodeConversationScope } from '../../../shared/code-project';
import { UI_HTML_VERSION, type UiHtmlSpec, type UiWindowEvent } from '../../../shared/ui-form';
import type { ConversationListItem, ConversationUnreadSummary } from '../../../shared/conversation';
import type { SkillListItem } from '../../../shared/skill-contracts';
import type { ToolConfirmationRequest } from '../../../shared/tools';
import { DEFAULT_CODE_VISIBLE_MESSAGES, DEFAULT_VISIBLE_MESSAGES } from '../constants/app-constants';
import { desktopAppClient } from '../desktop/desktop-app-client';
import { getLatestStreamingAssistantMessage, appendAssistantStreamDelta } from '../utils/agent-stream';
import {
  appendFilePreviewToSession,
  appendUiWidgetToSession,
  upsertToolInvocationToSession,
  pruneTransientCardsToTurns,
  markUiWidgetSubmitted,
  markUiWidgetPoppedOut,
  bufferStreamEvent,
  createEmptySession,
  createEmptyStore,
  ensureSession,
  flushSession,
  getSession,
  hasAnyRunning as storeHasAnyRunning,
  removeSession,
  updateSession,
  type FilePreviewItem,
  type UiWidgetItem,
  type ToolInvocationItem,
  type SessionState,
  type SessionStore,
} from '../utils/session-store';
import { writeLastActiveSession, readLastActiveSession, clearLastActiveSession, parseCodeProjectIdFromScope } from '../utils/last-active-session';
import { buildSkillInjection, extractSlashSkillNames, UI_DSL_SLASH_COMMAND, buildUiDslInjection, UI_HTML_SLASH_COMMAND, buildUiHtmlInjection } from '../utils/slash-command';
import { buildUiSubmitPromptForModel, buildUiSubmitSummary, type UiFormValues } from '../utils/ui-form-submit';
import { buildUiHtmlSubmitPromptForModel, buildUiHtmlSubmitSummary } from '../utils/ui-html-submit';
import { recordInput, clearInputHistory } from '../utils/input-history';
import type { SlashSkillOption } from '../utils/slash-command';

/**
 * 首屏消息条数。每条消息都要走一次 react-markdown 解析（实测约 11ms/条），
 * 首屏拉 50 条会让切换会话卡住 500ms+；20 条把首屏成本压到 200ms 出头，
 * 更早的历史由滚动到顶部时的 loadOlderConversationMessages 按需补齐。
 */
const INITIAL_MESSAGE_PAGE_SIZE = 20;
const OLDER_MESSAGE_PAGE_SIZE = 20;
/** 流式 delta 的合并刷新间隔（毫秒）。逐 delta setState 会让长回复把 renderer 压垮。 */
const STREAM_FLUSH_INTERVAL_MS = 120;
/**
 * "正在执行"面板的空闲判定：运行中且距上次可见流式增量超过该毫秒数就显示。
 * 稍高于正常吐字的 delta 间隔，避免吐字期间闪烁；又足够短，让工具参数流式/工具执行/换轮等
 * 静默窗口很快亮起指示。TICK 为重算节拍。
 */
const RUNNING_IDLE_THRESHOLD_MS = 600;
const RUNNING_IDLE_TICK_MS = 250;

/** 无活动会话时的空切片，避免各处 null 判断。 */
const EMPTY_SESSION: SessionState = createEmptySession();

/**
 * 解析文本里的 "/skill" 标记并取回正文，拼成注入段落。
 * 取不到详情的 skill 直接跳过 —— 宁可少注入，也不要让整条消息发不出去。
 */
async function buildSkillInjectionForPrompt(prompt: string, availableSkills: SlashSkillOption[]) {
  const names = extractSlashSkillNames(prompt, availableSkills.map((skill) => skill.name));
  if (names.length === 0) {
    return '';
  }

  // /json-ui、/html 是内置指令（无 SKILL.md），单独走固定注入；其余按用户 Skill 取正文
  const wantsUiDsl = names.includes(UI_DSL_SLASH_COMMAND);
  const wantsUiHtml = names.includes(UI_HTML_SLASH_COMMAND);
  const skillNames = names.filter((name) => name !== UI_DSL_SLASH_COMMAND && name !== UI_HTML_SLASH_COMMAND);

  const details = await Promise.all(skillNames.map(async (name) => {
    try {
      const detail = await desktopAppClient.getSkill(name);
      return detail ? { name: detail.name, directoryPath: detail.directoryPath, content: detail.content } : null;
    } catch {
      return null;
    }
  }));

  const sections: string[] = [];
  if (wantsUiDsl) {
    sections.push(buildUiDslInjection());
  }
  if (wantsUiHtml) {
    sections.push(buildUiHtmlInjection());
  }
  const skillInjection = buildSkillInjection(details.filter((detail): detail is NonNullable<typeof detail> => detail !== null));
  if (skillInjection) {
    sections.push(skillInjection);
  }
  return sections.join('\n\n');
}

export type PendingAttachment = {
  meta: AttachmentMeta;
  localPath: string;
  thumbnailDataUrl?: string;
};

export type { FilePreviewItem, UiWidgetItem, UiFormWidgetItem, UiHtmlWidgetItem, ToolInvocationItem } from '../utils/session-store';

type UseChatSessionOptions = {
  input: string;
  setInput: (value: string) => void;
  onRequestScrollToBottom?: () => void;
};

export function useChatSession({ input, setInput, onRequestScrollToBottom }: UseChatSessionOptions) {
  // ── 全局态（不随会话分桶）────────────────────────────────
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [agents, setAgents] = useState<AgentProfileListItem[]>([]);
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  /** Code 模式下绑定的代码工程；非空时本次请求走只读的 code_* 工具。 */
  const [selectedCodeProjectId, setSelectedCodeProjectId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversationList, setConversationList] = useState<ConversationListItem[]>([]);
  /** 按 scope 聚合的未读数，用于侧边栏智能体/工程徽标。 */
  const [unreadSummary, setUnreadSummary] = useState<ConversationUnreadSummary>({});
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [isInitialMessagesLoading, setIsInitialMessagesLoading] = useState(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  // 空闲重算触发器：运行期按节拍自增以驱动"正在执行"面板的空闲判定重算（值本身无意义）。
  const [, forceIdleRecheck] = useState(0);

  // ── 会话分桶 store（每个 conversationId 一份运行时视图）──────
  const [store, setStore] = useState<SessionStore>(() => createEmptyStore());
  const storeRef = useRef(store);
  useEffect(() => {
    storeRef.current = store;
  }, [store]);

  const activeConversationIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);
  /** 当前后端正在执行的会话（后端单例）。用于取消、工具确认归属、跨会话发送拦截。 */
  const runningConversationIdRef = useRef<string | null>(null);
  const activeStreamAgentIdRef = useRef<string | null>(null);

  // 记录"当前 scope + 激活会话"，供重启后恢复。scope 与 conversation.agentId 取值一致：
  // 代码工程用 code:{projectId}，智能体用其 id，默认智能体为 null。
  useEffect(() => {
    if (!activeConversationId) {
      return;
    }
    const scope = selectedCodeProjectId
      ? buildCodeConversationScope(selectedCodeProjectId)
      : selectedAgentId;
    writeLastActiveSession({ scope, conversationId: activeConversationId });
  }, [activeConversationId, selectedAgentId, selectedCodeProjectId]);

  // ── 派生：活动会话切片（对外仍暴露 messages/isRunning/... 等原字段）──
  const active = getSession(store, activeConversationId) ?? EMPTY_SESSION;
  const messages = active.messages;
  const messagesPageCursor = active.messagesPageCursor;
  const hasMoreMessagesBefore = active.hasMoreMessagesBefore;
  const isRunning = active.isRunning;
  const lastStreamAt = active.lastStreamAt;
  const runStatus = active.runStatus;
  const lastError = active.lastError;
  const confirmationRequest = active.confirmationRequest;
  const filePreviews = active.filePreviews;
  const uiWidgets = active.uiWidgets;
  const toolInvocations = active.toolInvocations;
  const expandedToolMessageKeys = active.expandedToolMessageKeys;
  const hasAnyRunning = storeHasAnyRunning(store);
  /** 正在运行的会话 id 集合，供 UI 禁用"运行中会话"的删除按钮。 */
  const runningConversationIds = useMemo(
    () => Object.entries(store.sessions).filter(([, session]) => session.isRunning).map(([id]) => id),
    [store],
  );

  /**
   * 流式 delta 合并刷新的 timer，按会话隔离：后台会话的缓冲与前台各自独立，
   * 避免多个会话的 delta 混进同一次 flush。缓冲数据本身存在 store 的桶里。
   */
  const flushTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  /** 立即冲刷某会话缓冲（清掉待触发 timer 后一次性合并）。 */
  const flushConversation = useCallback((conversationId: string) => {
    const timer = flushTimersRef.current.get(conversationId);
    if (timer) {
      clearTimeout(timer);
      flushTimersRef.current.delete(conversationId);
    }
    setStore((current) => flushSession(current, conversationId));
  }, []);

  /** 安排某会话缓冲的延时冲刷（已排期则复用）。 */
  const scheduleFlush = useCallback((conversationId: string) => {
    if (flushTimersRef.current.has(conversationId)) {
      return;
    }
    const timer = setTimeout(() => {
      flushTimersRef.current.delete(conversationId);
      setStore((current) => flushSession(current, conversationId));
      if (conversationId === activeConversationIdRef.current) {
        onRequestScrollToBottom?.();
      }
    }, STREAM_FLUSH_INTERVAL_MS);
    flushTimersRef.current.set(conversationId, timer);
  }, [onRequestScrollToBottom]);

  /** 丢弃某会话未冲刷的流缓冲（切换/重载/重置时防止旧 delta 追加到新内容上）。 */
  const clearPendingStreamEvents = useCallback((conversationId: string) => {
    const timer = flushTimersRef.current.get(conversationId);
    if (timer) {
      clearTimeout(timer);
      flushTimersRef.current.delete(conversationId);
    }
    setStore((current) => updateSession(current, conversationId, { pendingStreamEvents: [] }));
  }, []);

  const clearFilePreviews = useCallback((conversationId: string) => {
    setStore((current) => updateSession(current, conversationId, { filePreviews: [] }));
  }, []);

  /** 更新活动会话桶的某字段（对外暴露的 setRunStatus/setLastError/setConfirmationRequest 等由此派生）。 */
  const patchActiveSession = useCallback((patch: Partial<SessionState>) => {
    const id = activeConversationIdRef.current;
    if (!id) {
      return;
    }
    setStore((current) => updateSession(current, id, patch));
  }, []);

  /** 更新指定会话桶的某字段（后台会话的运行态/消息更新按其自身 id 定位，不受当前激活会话影响）。 */
  const patchSession = useCallback((conversationId: string, patch: Partial<SessionState>) => {
    setStore((current) => updateSession(current, conversationId, patch));
  }, []);

  const setRunStatus = useCallback((value: string) => patchActiveSession({ runStatus: value }), [patchActiveSession]);
  const setExpandedToolMessageKeys = useCallback(
    (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => {
      const id = activeConversationIdRef.current;
      if (!id) {
        return;
      }
      setStore((current) => updateSession(current, id, (prev) => ({ expandedToolMessageKeys: updater(prev.expandedToolMessageKeys) })));
    },
    [],
  );


  useEffect(() => {
    const refreshSkills = () => {
      void desktopAppClient.listSkills().then(setSkills).catch(() => {});
    };
    refreshSkills();
    // 安装/新增/删除 Skill 后主进程推送 skills:changed，实时刷新 "/" 指令候选与门控
    return desktopAppClient.onSkillsChanged(refreshSkills);
  }, []);

  /**
   * "/" 指令的候选列表，必须与运行时 getAgentSkillNameSet 的行为一致：
   * Code 模式开放全部 skill（getCodeRuntimeTools 不传 agentId）；chat 模式始终按当前智能体
   * （未显式选中时按 default）关联的 skill 过滤。否则会出现"菜单里能选，但模型的工具列表里没有"。
   */
  const availableSkills = useMemo<SlashSkillOption[]>(() => {
    const options: SlashSkillOption[] = skills.map((skill) => ({ name: skill.name, description: skill.description, kind: 'skill' }));

    const skillOptions = (() => {
      if (selectedCodeProjectId) {
        return options;
      }
      // 与运行时 agent-service 的 `agentId ?? DEFAULT_AGENT_ID` 归一化保持一致
      const allowedNames = new Set(agents.find((agent) => agent.id === (selectedAgentId ?? DEFAULT_AGENT_ID))?.skillNames ?? []);
      return options.filter((option) => allowedNames.has(option.name));
    })();

    // 内置指令：按当前智能体的开关注入（Code 模式一律不提供，二者都不注册工具）
    const effectiveAgent = agents.find((agent) => agent.id === (selectedAgentId ?? DEFAULT_AGENT_ID));
    const commands: SlashSkillOption[] = [];
    if (!selectedCodeProjectId && effectiveAgent?.uiDslEnabled) {
      commands.push({ name: UI_DSL_SLASH_COMMAND, description: '要求模型输出 JSON UI DSL，使用表单收集参数', kind: 'command' });
    }
    if (!selectedCodeProjectId && effectiveAgent?.uiHtmlEnabled) {
      commands.push({ name: UI_HTML_SLASH_COMMAND, description: '要求模型渲染交互式 HTML', kind: 'command' });
    }
    return [...commands, ...skillOptions];
  }, [agents, selectedAgentId, selectedCodeProjectId, skills]);

  const loadConversationMessages = useCallback(
    async (conversationId: string) => {
      // 会话切换/重载会整体替换该会话桶的 messages，先丢掉未冲刷的流缓冲，避免旧 delta 追加到重载后的内容上
      clearPendingStreamEvents(conversationId);
      setIsInitialMessagesLoading(true);
      try {
        const page = await desktopAppClient.getConversationMessagesPage(conversationId, {
          cursor: null,
          limit: INITIAL_MESSAGE_PAGE_SIZE,
        });
        setStore((current) => updateSession(ensureSession(current, conversationId), conversationId, {
          messages: page.messages,
          messagesPageCursor: page.nextCursor,
          hasMoreMessagesBefore: page.hasMoreBefore,
        }));
        if (conversationId === activeConversationIdRef.current) {
          onRequestScrollToBottom?.();
        }
        return page.messages;
      } finally {
        setIsInitialMessagesLoading(false);
      }
    },
    [clearPendingStreamEvents, onRequestScrollToBottom],
  );

  const loadOlderConversationMessages = useCallback(async () => {
    const conversationId = activeConversationIdRef.current;
    if (!conversationId || !hasMoreMessagesBefore || isLoadingOlderMessages || !messagesPageCursor) {
      return false;
    }

    setIsLoadingOlderMessages(true);
    try {
      const page = await desktopAppClient.getConversationMessagesPage(conversationId, {
        cursor: messagesPageCursor,
        limit: OLDER_MESSAGE_PAGE_SIZE,
      });
      setStore((current) => updateSession(current, conversationId, (prev) => ({
        messages: [...page.messages, ...prev.messages],
        messagesPageCursor: page.nextCursor,
        hasMoreMessagesBefore: page.hasMoreBefore,
      })));
      return page.messages.length > 0;
    } finally {
      setIsLoadingOlderMessages(false);
    }
  }, [hasMoreMessagesBefore, isLoadingOlderMessages, messagesPageCursor]);

  const refreshConversationList = useCallback(
    async (scopeKey: string | null) => {
      try {
        const items = await desktopAppClient.listConversationsByAgent(scopeKey);
        setConversationList(items);
        return items;
      } catch {
        setConversationList([]);
        return [];
      }
    },
    [],
  );

  const refreshUnreadSummary = useCallback(async () => {
    try {
      setUnreadSummary(await desktopAppClient.getConversationUnreadSummary());
    } catch {
      setUnreadSummary({});
    }
  }, []);

  useEffect(() => {
    void refreshUnreadSummary();
  }, [refreshUnreadSummary]);

  /** 清零某会话未读；返回是否真的有未读被清掉（有则说明该会话落了新消息，需要重载）。 */
  const clearConversationUnread = useCallback(
    async (conversationId: string) => {
      try {
        const cleared = await desktopAppClient.clearConversationUnread(conversationId);
        if (cleared > 0) {
          setConversationList((current) => current.map((item) => (
            item.id === conversationId ? { ...item, unreadCount: 0 } : item
          )));
          void refreshUnreadSummary();
        }
        return cleared > 0;
      } catch {
        return false;
      }
    },
    [refreshUnreadSummary],
  );

  // 主进程后台生成的会话标题、定时任务落地的未读数推送过来，就地更新下拉列表，无需整表刷新
  useEffect(() => {
    return desktopAppClient.onConversationChanged((event) => {
      setConversationList((current) => current.map((item) => (
        item.id === event.conversationId
          ? {
            ...item,
            title: event.title,
            unreadCount: event.unreadCount ?? item.unreadCount,
            messageCount: event.messageCount ?? item.messageCount,
          }
          : item
      )));

      if ((event.unreadCount ?? 0) > 0) {
        void refreshUnreadSummary();
        // 定时任务结果落在当前正看着的空闲会话：直接清未读并重载，让用户立刻看到
        const isActive = event.conversationId === activeConversationIdRef.current;
        const session = getSession(storeRef.current, event.conversationId);
        if (isActive && !session?.isRunning) {
          void (async () => {
            await clearConversationUnread(event.conversationId);
            await loadConversationMessages(event.conversationId);
          })();
        }
      }
    });
  }, [clearConversationUnread, loadConversationMessages, refreshUnreadSummary]);

  /** 切到目标会话：已有桶直接激活（即时，无重载）；无桶则建桶并从磁盘加载。 */
  const activateConversation = useCallback(
    async (conversationId: string) => {
      setActiveConversationId(conversationId);
      // 有未读（定时任务结果）时必须重载：桶里的消息是追加前的旧视图
      const hadUnread = await clearConversationUnread(conversationId);
      const existing = getSession(storeRef.current, conversationId);
      // 已有桶（含运行中的后台会话）：直接展示其当前内存视图，不重载、不打断
      if (!hadUnread && existing && (existing.messages.length > 0 || existing.isRunning || existing.pendingStreamEvents.length > 0)) {
        setStore((current) => ensureSession(current, conversationId));
        onRequestScrollToBottom?.();
        return;
      }
      // 无桶或空桶：建桶 + 加载首屏
      setStore((current) => ensureSession(current, conversationId));
      await loadConversationMessages(conversationId);
    },
    [clearConversationUnread, loadConversationMessages, onRequestScrollToBottom],
  );

  /**
   * 切换会话归属。scopeKey 即 conversation.agentId：智能体用其 id，
   * 代码工程用 code:{projectId}，默认智能体用 null。
   */
  const switchConversationScope = useCallback(
    async (scopeKey: string | null) => {
      setAttachments([]);
      const conversations = await desktopAppClient.listConversationsByAgent(scopeKey);
      setConversationList(conversations);
      if (conversations.length > 0) {
        // 列表按最近更新倒序，默认进入最近使用的会话
        await activateConversation(conversations[0].id);
      } else {
        const meta = await desktopAppClient.createConversation(scopeKey);
        setStore((current) => ensureSession(current, meta.id));
        setActiveConversationId(meta.id);
        await refreshConversationList(scopeKey);
        onRequestScrollToBottom?.();
      }
    },
    [activateConversation, onRequestScrollToBottom, refreshConversationList],
  );

  const handleAgentSelection = useCallback(
    async (nextAgentId: string | null) => {
      setSelectedCodeProjectId(null);
      setSelectedAgentId(nextAgentId);
      await switchConversationScope(nextAgentId);
    },
    [switchConversationScope],
  );
  const handleCodeProjectSelection = useCallback(
    async (projectId: string) => {
      setSelectedAgentId(null);
      setSelectedCodeProjectId(projectId);
      await switchConversationScope(buildCodeConversationScope(projectId));
    },
    [switchConversationScope],
  );

  /**
   * 启动时恢复上次激活的会话。返回恢复用到的 scope（供 App 同步 mode/展开态），
   * 恢复失败（无记录、scope 已删、会话已删）时返回 undefined，由调用方回退默认。
   */
  const restoreLastActiveSession = useCallback(
    async (): Promise<{ scope: string | null; conversationId: string } | undefined> => {
      const saved = readLastActiveSession();
      if (!saved) {
        return undefined;
      }

      try {
        const conversations = await desktopAppClient.listConversationsByAgent(saved.scope);
        const target = conversations.find((item) => item.id === saved.conversationId);
        if (!target) {
          // 记录里的会话已被删除或 scope 已失效：清掉陈旧记录，交回默认流程
          clearLastActiveSession();
          return undefined;
        }

        const codeProjectId = parseCodeProjectIdFromScope(saved.scope);
        if (codeProjectId) {
          setSelectedAgentId(null);
          setSelectedCodeProjectId(codeProjectId);
        } else {
          setSelectedCodeProjectId(null);
          setSelectedAgentId(saved.scope);
        }

        setConversationList(conversations);
        setStore((current) => ensureSession(current, target.id));
        setActiveConversationId(target.id);
        await loadConversationMessages(target.id);
        return { scope: saved.scope, conversationId: target.id };
      } catch {
        return undefined;
      }
    },
    [loadConversationMessages],
  );

  /** 在当前 scope 内切换到指定会话（智能体下拉列表点击）。 */
  const handleSelectConversation = useCallback(
    async (conversationId: string) => {
      if (conversationId === activeConversationId) {
        return;
      }
      // 允许在生成中切走：后台 run 继续在其桶内累积（流事件按 conversationId 路由），
      // 切换只换视图。已有桶即时切、无桶才重载。附件是全局输入态，切换时清空。
      setAttachments([]);
      await activateConversation(conversationId);
    },
    [activateConversation, activeConversationId],
  );

  /** 在当前 scope 内新增一个会话并切换过去（下拉列表"+ 新增会话"）。 */
  const handleCreateConversation = useCallback(
    async () => {
      if (isCreatingConversation) {
        return;
      }
      const scopeKey = selectedCodeProjectId ? buildCodeConversationScope(selectedCodeProjectId) : selectedAgentId;
      setIsCreatingConversation(true);
      try {
        const meta = await desktopAppClient.createConversation(scopeKey);
        setStore((current) => ensureSession(current, meta.id));
        setActiveConversationId(meta.id);
        setAttachments([]);
        await refreshConversationList(scopeKey);
        onRequestScrollToBottom?.();
      } catch (error) {
        patchActiveSession({ lastError: error instanceof Error ? error.message : '创建会话失败。' });
      } finally {
        setIsCreatingConversation(false);
      }
    },
    [clearFilePreviews, isCreatingConversation, isRunning, onRequestScrollToBottom, refreshConversationList, selectedAgentId, selectedCodeProjectId],
  );

  /** 删除会话（下拉列表删除按钮）。运行中的会话禁止删除；删除激活会话后切到剩余最近会话，删空则新建。 */
  const handleDeleteConversation = useCallback(
    async (conversationId: string) => {
      // 硬约束：正在后台运行的会话（不论是否为当前激活）必须等其执行结束才能删除
      if (getSession(storeRef.current, conversationId)?.isRunning) {
        patchActiveSession({ runStatus: '该会话正在执行，结束后才能删除。' });
        return;
      }
      const isDeletingActive = conversationId === activeConversationId;
      const scopeKey = selectedCodeProjectId ? buildCodeConversationScope(selectedCodeProjectId) : selectedAgentId;
      try {
        const result = await desktopAppClient.deleteConversation(conversationId);
        if (!result.ok) {
          patchActiveSession({ lastError: result.error ?? '删除会话失败。' });
          return;
        }
        // 会话删了，随带清掉它的输入记录
        clearInputHistory(conversationId);
        setStore((current) => removeSession(current, conversationId));
        void refreshUnreadSummary();
        const remaining = await refreshConversationList(scopeKey);
        if (!isDeletingActive) {
          return;
        }
        if (remaining.length > 0) {
          await activateConversation(remaining[0].id);
        } else {
          // 删空后立刻新建，新会话 id 会经持久化 effect 覆盖旧记录；
          // 主动清一次，避免新建失败时残留已删会话的陈旧引用
          clearLastActiveSession();
          const meta = await desktopAppClient.createConversation(scopeKey);
          setStore((current) => ensureSession(current, meta.id));
          setActiveConversationId(meta.id);
          await refreshConversationList(scopeKey);
          onRequestScrollToBottom?.();
        }
      } catch (error) {
        patchActiveSession({ lastError: error instanceof Error ? error.message : '删除会话失败。' });
      }
    },
    [activateConversation, activeConversationId, onRequestScrollToBottom, patchActiveSession, refreshConversationList, refreshUnreadSummary, selectedAgentId, selectedCodeProjectId],
  );

  /** 重命名会话（下拉列表编辑框提交）。成功后由 conversation:changed 推送事件就地更新列表。 */
  const handleRenameConversation = useCallback(
    async (conversationId: string, title: string) => {
      const nextTitle = title.trim();
      if (!nextTitle) {
        return;
      }
      try {
        const result = await desktopAppClient.renameConversation(conversationId, nextTitle);
        if (!result.ok) {
          patchActiveSession({ lastError: result.error ?? '重命名会话失败。' });
        }
      } catch (error) {
        patchActiveSession({ lastError: error instanceof Error ? error.message : '重命名会话失败。' });
      }
    },
    [patchActiveSession],
  );

  /**
   * 撤销会话：从指定消息回退，删除该消息及其后所有内容。
   * 运行中的会话禁止撤销（与删除会话同一硬约束）；成功后重载该会话桶并同步侧边栏。
   */
  const handleUndoFromMessage = useCallback(
    async (conversationId: string, messageId: string) => {
      if (getSession(storeRef.current, conversationId)?.isRunning) {
        patchSession(conversationId, { runStatus: '该会话正在执行，结束后才能撤销。' });
        return;
      }
      try {
        const result = await desktopAppClient.truncateConversation(conversationId, messageId);
        if (!result.ok) {
          patchSession(conversationId, { lastError: result.error ?? '撤销失败。' });
        }
        // 无论成功与否都重载该桶：失败时也能纠正视图（如消息已被并发截断）
        const reloaded = await loadConversationMessages(conversationId);
        // 截断历史后清理被撤销轮次的瞬时卡片（工具调用/预览/交互组件）：以重载后仍存在的
        // 用户消息 id 为准，否则这些卡片会在下次发送后被兜底锚定逻辑重新挂到残留消息上"复活"。
        const survivingTurnUserIds = new Set(
          reloaded.reduce<string[]>((ids, message) => {
            if (message.role === 'user' && message.id) {
              ids.push(message.id);
            }
            return ids;
          }, []),
        );
        setStore((current) => pruneTransientCardsToTurns(current, conversationId, survivingTurnUserIds));
        const scopeKey = selectedCodeProjectId ? buildCodeConversationScope(selectedCodeProjectId) : selectedAgentId;
        await refreshConversationList(scopeKey);
      } catch (error) {
        patchSession(conversationId, { lastError: error instanceof Error ? error.message : '撤销失败。' });
      }
    },
    [loadConversationMessages, patchSession, refreshConversationList, selectedAgentId, selectedCodeProjectId],
  );

  const handleToggleToolMessage = useCallback((messageKey: string) => {
    setExpandedToolMessageKeys((current) => ({
      ...current,
      [messageKey]: !current[messageKey],
    }));
  }, [setExpandedToolMessageKeys]);

  async function handleRunAgent(
    override?: { prompt: string; promptForModel: string },
    targetConversationId?: string,
    scopeOverride?: { agentId: string | null; codeProjectId: string | null },
  ) {
    // 弹出窗口提交可针对非活动会话，此时用弹出时捕获的 scope，避免落到当前选中的智能体
    const activeAgentId = scopeOverride ? scopeOverride.agentId : selectedAgentId;
    const activeCodeProjectId = scopeOverride ? scopeOverride.codeProjectId : selectedCodeProjectId;
    const prompt = override ? override.prompt : input.trim();
    let conversationId = targetConversationId ?? activeConversationId;

    if (!prompt && attachments.length === 0) {
      patchActiveSession({ runStatus: '请输入要发送的指令或添加附件。' });
      return;
    }

    // 后端单例：已有会话在跑时，不允许在别的会话发起新请求
    if (storeHasAnyRunning(storeRef.current) && runningConversationIdRef.current !== conversationId) {
      patchActiveSession({ runStatus: '有会话正在执行，请等待其完成或取消后再发送。' });
      return;
    }

    if (!conversationId) {
      // 新智能体/新工程还没有会话时直接发送：兜底创建一个会话再执行
      try {
        const scopeKey = activeCodeProjectId ? buildCodeConversationScope(activeCodeProjectId) : activeAgentId;
        const meta = await desktopAppClient.createConversation(scopeKey);
        setStore((current) => ensureSession(current, meta.id));
        setActiveConversationId(meta.id);
        conversationId = meta.id;
      } catch (error) {
        patchActiveSession({ runStatus: error instanceof Error ? `创建会话失败：${error.message}` : '创建会话失败。' });
        return;
      }
    }

    // 本次 run 绑定的会话 id（闭包捕获，后续所有该会话的状态更新都按它定位桶）
    const runConversationId = conversationId;
    runningConversationIdRef.current = runConversationId;
    activeStreamAgentIdRef.current = activeAgentId;
    const optimisticAttachments = override ? [] : attachments;
    if (!override) {
      // 记录本次真实输入到该会话的输入记录（含 "/" 原文；纯附件无文字时 prompt 为空，不记）
      if (prompt) {
        recordInput(runConversationId, prompt);
      }
      setInput('');
      setAttachments([]);
    }
    const optimisticUserMessage = prompt || [
      '【已发送附件】',
      ...optimisticAttachments.map((attachment, index) => `${index + 1}. ${attachment.meta.originalName}（${attachment.meta.kind}，${attachment.meta.size} bytes）`),
    ].join('\n');
    setStore((current) => updateSession(ensureSession(current, runConversationId), runConversationId, (prev) => ({
      isRunning: true,
      lastStreamAt: 0,
      confirmationRequest: null,
      lastError: null,
      runStatus: 'Agent 正在执行...',
      messages: [
        ...prev.messages,
        {
          role: 'user',
          content: optimisticUserMessage,
          attachments: optimisticAttachments.map((attachment) => attachment.meta),
        },
      ],
    })));
    if (runConversationId === activeConversationIdRef.current) {
      onRequestScrollToBottom?.();
    }

    try {
      const persistedAttachments = optimisticAttachments.length > 0
        ? await desktopAppClient.persistAttachments(
            runConversationId,
            optimisticAttachments.map((attachment) => ({ localPath: attachment.localPath, meta: attachment.meta })),
          )
        : [];
      const persistedAttachmentMetas = persistedAttachments.map((attachment) => ({
        ...attachment.meta,
        storedPath: attachment.storedPath,
      }));
      // 附件的元信息、绝对路径与提取内容一律由主进程预处理统一注入
      // （agent-service.buildAttachmentProcessingPayload → run() 拼到 promptForModel 之后）。
      // "/" 指令：把 SKILL.md 正文追加到发给模型的那一份，界面与落盘仍是用户原文；
      // 表单提交（override）已在上游构造好 prompt/promptForModel，这里不再叠加 skill 注入。
      let promptForModel = prompt;
      if (override) {
        promptForModel = override.promptForModel;
      } else {
        const skillInjection = await buildSkillInjectionForPrompt(prompt, availableSkills);
        if (skillInjection) {
          promptForModel = `${prompt}\n\n${skillInjection}`;
        }
      }
      const response = await desktopAppClient.runAgent({
        prompt,
        promptForModel,
        conversationId: runConversationId,
        attachments: persistedAttachments.map((attachment) => ({ localPath: attachment.storedPath, meta: attachment.meta })),
        ...(activeAgentId ? { agentId: activeAgentId } : {}),
        ...(activeCodeProjectId ? { codeProjectId: activeCodeProjectId } : {}),
      });
      // 回填附件元信息到该会话桶的最后一条用户消息
      setStore((current) => updateSession(current, runConversationId, (prev) => {
        const nextMessages = [...prev.messages];
        const lastMessage = nextMessages[nextMessages.length - 1];
        if (lastMessage?.role === 'user') {
          nextMessages[nextMessages.length - 1] = { ...lastMessage, attachments: persistedAttachmentMetas };
        }
        return { messages: nextMessages };
      }));
      // 首轮对话后主进程会生成会话标题，刷新列表让下拉显示新标题（跨 scope 也需要，故不设条件）
      const runScopeKey = activeCodeProjectId ? buildCodeConversationScope(activeCodeProjectId) : activeAgentId;
      await refreshConversationList(runScopeKey);
      // 请求完成后重载该会话消息（无论是否在前台，桶都要拿到落盘后的完整结果）
      await loadConversationMessages(runConversationId);
      patchSession(runConversationId, { runStatus: response.toolCalls.length > 0 ? '已完成工具调用。' : '已收到模型回复。' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent 执行失败。';
      const snapshot = await loadConversationMessages(runConversationId).catch(() => [] as AgentMessage[]);
      setStore((current) => updateSession(current, runConversationId, (prev) => ({
        lastError: message,
        runStatus: message,
        // 若落盘为空（极早失败），至少保留乐观用户消息；附件回填到输入框供重试
        messages: snapshot.length === 0 && prev.messages.length === 0
          ? [{ role: 'user', content: optimisticUserMessage }]
          : prev.messages,
      })));
      if (runConversationId === activeConversationIdRef.current) {
        setAttachments(optimisticAttachments);
      }
    } finally {
      if (runningConversationIdRef.current === runConversationId) {
        runningConversationIdRef.current = null;
        activeStreamAgentIdRef.current = null;
      }
      patchSession(runConversationId, { isRunning: false, confirmationRequest: null });
    }
  }

  /** 会话区交互组件提交（表单或 HTML）：锁定该组件后走与普通发送同一条 runAgent 链路。 */
  async function handleUiFormSubmit(widgetId: string, values: Record<string, unknown>) {
    const conversationId = activeConversationIdRef.current;
    if (!conversationId) {
      return;
    }
    // 后端单例：有任意会话在跑就拦下（handleRunAgent 内也有兜底，这里先给出即时反馈）
    if (storeHasAnyRunning(storeRef.current)) {
      patchActiveSession({ runStatus: '有会话正在执行，请等待其完成或取消后再提交。' });
      return;
    }
    const widget = getSession(storeRef.current, conversationId)?.uiWidgets.find((item) => item.widgetId === widgetId);
    if (!widget || widget.submitted) {
      return;
    }
    // 先锁定，避免用户连点触发多轮
    setStore((current) => markUiWidgetSubmitted(current, conversationId, widgetId));
    const override = widget.kind === 'form'
      ? {
        prompt: buildUiSubmitSummary(widget.spec, values as UiFormValues),
        promptForModel: buildUiSubmitPromptForModel(widget.spec, values as UiFormValues),
      }
      : {
        prompt: buildUiHtmlSubmitSummary(widget.spec.title, values),
        promptForModel: buildUiHtmlSubmitPromptForModel(widget.spec, values),
      };
    await handleRunAgent(override);
  }

  // 弹出窗口打开时捕获会话 scope：提交可能发生在用户切走之后，用它保证回流落到正确的智能体
  const poppedOutScopeRef = useRef<Map<string, { agentId: string | null; codeProjectId: string | null }>>(new Map());

  /** 打开交互式 HTML 的独立窗口：内联降级为占位，独立窗口作为唯一交互实例。 */
  async function handleUiHtmlPopOut(widgetId: string) {
    const conversationId = activeConversationIdRef.current;
    if (!conversationId) {
      return;
    }
    const widget = getSession(storeRef.current, conversationId)?.uiWidgets.find((item) => item.widgetId === widgetId);
    if (!widget || widget.kind !== 'html') {
      return;
    }
    poppedOutScopeRef.current.set(conversationId, { agentId: selectedAgentId, codeProjectId: selectedCodeProjectId });
    try {
      const result = await desktopAppClient.openUiWindow({
        conversationId,
        widgetId,
        title: widget.spec.title,
        html: widget.spec.html,
      });
      if (result.opened) {
        setStore((current) => markUiWidgetPoppedOut(current, conversationId, widgetId, true));
      }
    } catch (error) {
      patchSession(conversationId, { lastError: error instanceof Error ? error.message : '打开独立窗口失败。' });
    }
  }

  /** 收回独立窗口（关闭它；closed 事件会把内联占位恢复为实时渲染）。 */
  async function handleUiHtmlReclaim(widgetId: string) {
    try {
      await desktopAppClient.closeUiWindow(widgetId);
    } catch {
      // 关闭失败不阻塞：用户手动关闭窗口仍会触发 closed 恢复内联
    }
  }

  /** 独立窗口内提交回流：锁定组件并走与内联同一条 runAgent 链路（可针对已切走的后台会话）。 */
  async function handleUiWindowSubmit(event: Extract<UiWindowEvent, { type: 'submit' }>) {
    const { conversationId, widgetId, title, data } = event;
    if (storeHasAnyRunning(storeRef.current)) {
      patchSession(conversationId, { runStatus: '有会话正在执行，请等待其完成或取消后再提交。' });
      return;
    }
    const widget = getSession(storeRef.current, conversationId)?.uiWidgets.find((item) => item.widgetId === widgetId);
    if (widget?.submitted) {
      return;
    }
    // 锁定；窗口仍开着，占位保持到 closed 事件才恢复内联
    setStore((current) => markUiWidgetSubmitted(current, conversationId, widgetId));
    const spec: UiHtmlSpec = widget && widget.kind === 'html'
      ? widget.spec
      : { version: UI_HTML_VERSION, widgetId, title, html: '' };
    const override = {
      prompt: buildUiHtmlSubmitSummary(spec.title, data),
      promptForModel: buildUiHtmlSubmitPromptForModel(spec, data),
    };
    await handleRunAgent(override, conversationId, poppedOutScopeRef.current.get(conversationId));
  }

  // 用 ref 持有最新 submit 处理器，保持订阅 effect 稳定（只挂一次监听）
  const handleUiWindowSubmitRef = useRef(handleUiWindowSubmit);
  handleUiWindowSubmitRef.current = handleUiWindowSubmit;

  useEffect(() => {
    return desktopAppClient.onUiWindowEvent((event) => {
      if (event.type === 'submit') {
        void handleUiWindowSubmitRef.current(event);
        return;
      }
      // closed：清除占位，内联卡片恢复实时渲染
      setStore((current) => markUiWidgetPoppedOut(current, event.conversationId, event.widgetId, false));
    });
  }, []);

  async function handleCancelAgent() {
    const runningId = runningConversationIdRef.current;
    if (runningId) {
      clearPendingStreamEvents(runningId);
    }
    const result = await desktopAppClient.cancelAgent();
    activeStreamAgentIdRef.current = null;
    if (runningId) {
      patchSession(runningId, {
        isRunning: false,
        confirmationRequest: null,
        runStatus: result.cancelled ? '已请求取消当前执行。' : '当前没有正在执行的请求。',
      });
    }
    runningConversationIdRef.current = null;
  }

  async function handleResetAgent() {
    const id = activeConversationIdRef.current;
    if (!id) {
      return;
    }
    clearPendingStreamEvents(id);
    await desktopAppClient.resetConversation(id);
    setAttachments([]);
    setStore((current) => updateSession(current, id, {
      messages: [],
      messagesPageCursor: null,
      hasMoreMessagesBefore: false,
      filePreviews: [],
      uiWidgets: [],
      toolInvocations: [],
      runStatus: '会话已重置。',
      confirmationRequest: null,
      lastError: null,
    }));
    onRequestScrollToBottom?.();
  }

  function handleAgentsChanged(nextAgents: AgentProfileListItem[]) {
    setAgents(nextAgents);
    if (selectedAgentId && !nextAgents.some((agent) => agent.id === selectedAgentId)) {
      void handleAgentSelection(null);
    }
  }

  async function handleToolConfirmation(approved: boolean, autoRun = false, autoAllowCommand = false, autoAllowDomain = false) {
    await desktopAppClient.respondToolConfirmation({
      approved,
      autoRun: approved ? autoRun : false,
      autoAllowCommand: approved ? autoAllowCommand : false,
      autoAllowDomain: approved ? autoAllowDomain : false,
    });
    // 确认弹窗归属正在运行的会话（后端单例），把状态写回该会话桶
    const runningId = runningConversationIdRef.current ?? activeConversationIdRef.current;
    if (runningId) {
      patchSession(runningId, {
        confirmationRequest: null,
        runStatus: approved ? '已确认工具执行，等待结果...' : '已拒绝工具执行。',
      });
    }
  }

  const visibleMessages = useMemo<AgentMessage[]>(() => {
    if (messages.length > 0) {
      return messages;
    }

    return selectedCodeProjectId ? DEFAULT_CODE_VISIBLE_MESSAGES : DEFAULT_VISIBLE_MESSAGES;
  }, [messages, selectedCodeProjectId]);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  /** 激活会话的标题（含自动生成与手动改名后的推送更新）；未命中时为 null，由 UI 回退显示智能体/工程名。 */
  const activeConversationTitle = useMemo(
    () => conversationList.find((item) => item.id === activeConversationId)?.title ?? null,
    [conversationList, activeConversationId],
  );
  const latestStreamingAssistantMessage = useMemo(() => getLatestStreamingAssistantMessage(messages), [messages]);
  // "正在执行"面板：运行中且当前处于「静默」（距上次可见流式增量超过阈值）时显示。
  // 用空闲计时而非"最后一条助手消息是否有内容"或某个阶段信令：模型在调工具前输出旁白后，
  // 工具参数流式拼装、工具执行、换轮等待都没有可见增量，会被判为静默从而亮起指示，
  // 避免"输出一段文字后干等、看似卡死"（Grok 这类爱先写旁白再调工具的模型尤为明显）。
  const streamIdleMs = Date.now() - lastStreamAt;
  const showRunningActivityPanel = isRunning && !confirmationRequest && !lastError && streamIdleMs >= RUNNING_IDLE_THRESHOLD_MS;
  const showErrorActivityPanel = Boolean(lastError) && !confirmationRequest;

  // 时间流逝本身不会触发 React 重渲染：运行期按节拍强制重算，让空闲判定能在静默中及时亮起面板。
  useEffect(() => {
    if (!isRunning) {
      return;
    }
    const timer = setInterval(() => forceIdleRecheck((tick) => tick + 1), RUNNING_IDLE_TICK_MS);
    return () => clearInterval(timer);
  }, [isRunning]);

  const applyStreamDelta = useCallback(
    (event: AgentStreamEvent) => {
      // 流事件按 conversationId 路由到对应会话桶：后台会话（非当前激活）照常累积，
      // 切回时即见实时内容。无 conversationId 的旧事件回退到当前激活会话。
      const targetId = event.conversationId ?? activeConversationIdRef.current;
      if (!targetId) {
        return;
      }

      if (event.filePreview) {
        setStore((current) => appendFilePreviewToSession(current, targetId, event.filePreview!));
        if (targetId === activeConversationIdRef.current) {
          onRequestScrollToBottom?.();
        }
        return;
      }

      if (event.uiWidget) {
        setStore((current) => appendUiWidgetToSession(current, targetId, event.uiWidget!));
        if (targetId === activeConversationIdRef.current) {
          onRequestScrollToBottom?.();
        }
        return;
      }

      if (event.toolInvocation) {
        setStore((current) => upsertToolInvocationToSession(current, targetId, event.toolInvocation!));
        if (targetId === activeConversationIdRef.current) {
          onRequestScrollToBottom?.();
        }
        return;
      }

      // done 事件先冲刷缓冲，保证消息边界顺序
      if (event.done) {
        flushConversation(targetId);
        return;
      }

      if (event.deltaContent || event.deltaReasoningContent) {
        // 收到可见增量：刷新 lastStreamAt（供"正在执行"面板判空闲），并缓冲合并
        setStore((current) => updateSession(bufferStreamEvent(current, targetId, event), targetId, {
          lastStreamAt: Date.now(),
          runStatus: '模型正在生成回复...',
        }));
        scheduleFlush(targetId);
        if (targetId === activeConversationIdRef.current) {
          onRequestScrollToBottom?.();
        }
        return;
      }

      // 非 delta 的即时事件（如仅 streamMessageId 占位）直接合并
      setStore((current) => updateSession(current, targetId, (prev) => ({
        messages: appendAssistantStreamDelta(prev.messages, event),
      })));
      if (targetId === activeConversationIdRef.current) {
        onRequestScrollToBottom?.();
      }
    },
    [flushConversation, onRequestScrollToBottom, patchSession, scheduleFlush],
  );

  /** 工具确认请求到达：归属正在运行的会话桶（后端单例）。供 bootstrap 的 onToolConfirmationRequested 调用。 */
  const applyConfirmationRequest = useCallback((request: ToolConfirmationRequest) => {
    const targetId = runningConversationIdRef.current ?? activeConversationIdRef.current;
    if (!targetId) {
      return;
    }
    patchSession(targetId, { confirmationRequest: request });
  }, [patchSession]);

  return {
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
    setSelectedAgentId,
    selectedCodeProjectId,
    setSelectedCodeProjectId,
    handleCodeProjectSelection,
    selectedAgent,
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
    activeStreamAgentIdRef,
    loadConversationMessages,
    loadOlderConversationMessages,
    hasMoreMessagesBefore,
    isInitialMessagesLoading,
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
    latestStreamingAssistantMessage,
    showRunningActivityPanel,
    showErrorActivityPanel,
    applyStreamDelta,
    applyConfirmationRequest,
    filePreviews,
    uiWidgets,
    toolInvocations,
    handleUiFormSubmit,
    handleUiHtmlPopOut,
    handleUiHtmlReclaim,
    ensureConversationBucket: (conversationId: string) => setStore((current) => ensureSession(current, conversationId)),
  };
}
