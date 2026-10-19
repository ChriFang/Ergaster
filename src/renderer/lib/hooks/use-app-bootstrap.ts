import { useEffect, useRef } from 'react';
import type { AgentStreamEvent } from '../../../shared/agent';
import type { WorkflowStreamEvent } from '../../../shared/workflow';

import type { AgentProfileListItem } from '../../../shared/agent-profile';
import type { AppConfig, MaskedAppConfig } from '../../../shared/config';
import type { AppInfo } from '../../../shared/contracts';
import type { ToolConfirmationRequest } from '../../../shared/tools';
import { desktopAppClient } from '../desktop/desktop-app-client';


type UseAppBootstrapOptions = {
  setAppInfo: (value: AppInfo) => void;
  setConfig: (value: MaskedAppConfig) => void;
  setFormValues: (value: AppConfig) => void;
  setShowApiKey: (value: boolean) => void;
  normalizeConfigForm: (value: MaskedAppConfig) => AppConfig;
  ensureDefaultConversation: () => Promise<unknown>;
  setAgents: (value: AgentProfileListItem[]) => void;
  applyConfirmationRequest: (request: ToolConfirmationRequest) => void;
  onRequestScrollToBottom: () => void;
  activeStreamAgentIdRef: { current: string | null };
  applyStreamDelta: (event: AgentStreamEvent) => void;
  loadWorkflowRuns?: () => Promise<unknown>;
  reloadWorkflows?: () => Promise<void>;
  activeRunIdRef?: { current: string | null };
  applyWorkflowStream?: (event: WorkflowStreamEvent) => void;
  refreshModels?: () => Promise<void> | void;
};


export function useAppBootstrap({
  setAppInfo,
  setConfig,
  setFormValues,
  setShowApiKey,
  normalizeConfigForm,
  ensureDefaultConversation,
  setAgents,
  applyConfirmationRequest,
  onRequestScrollToBottom,
  activeStreamAgentIdRef,
  applyStreamDelta,
  loadWorkflowRuns,
  reloadWorkflows,
  activeRunIdRef,
  applyWorkflowStream,
  refreshModels,
}: UseAppBootstrapOptions) {
  const ensureDefaultConversationRef = useRef(ensureDefaultConversation);
  const applyStreamDeltaRef = useRef(applyStreamDelta);
  const applyConfirmationRequestRef = useRef(applyConfirmationRequest);
  const normalizeConfigFormRef = useRef(normalizeConfigForm);
  const loadWorkflowRunsRef = useRef(loadWorkflowRuns);
  const reloadWorkflowsRef = useRef(reloadWorkflows);
  const applyWorkflowStreamRef = useRef(applyWorkflowStream);
  const refreshModelsRef = useRef(refreshModels);
  const onRequestScrollToBottomRef = useRef(onRequestScrollToBottom);


  useEffect(() => {
    ensureDefaultConversationRef.current = ensureDefaultConversation;
  }, [ensureDefaultConversation]);

  useEffect(() => {
    applyStreamDeltaRef.current = applyStreamDelta;
  }, [applyStreamDelta]);

  useEffect(() => {
    applyConfirmationRequestRef.current = applyConfirmationRequest;
  }, [applyConfirmationRequest]);

  useEffect(() => {
    normalizeConfigFormRef.current = normalizeConfigForm;
  }, [normalizeConfigForm]);

  useEffect(() => {
    loadWorkflowRunsRef.current = loadWorkflowRuns;
  }, [loadWorkflowRuns]);

  useEffect(() => {
    reloadWorkflowsRef.current = reloadWorkflows;
  }, [reloadWorkflows]);

  useEffect(() => {
    applyWorkflowStreamRef.current = applyWorkflowStream;
  }, [applyWorkflowStream]);

  useEffect(() => {
    refreshModelsRef.current = refreshModels;
  }, [refreshModels]);

  useEffect(() => {
    onRequestScrollToBottomRef.current = onRequestScrollToBottom;
  }, [onRequestScrollToBottom]);

  useEffect(() => {

    void desktopAppClient.getAppInfo().then(setAppInfo);
    void desktopAppClient.getConfig().then((nextConfig) => {
      setConfig(nextConfig);
      setFormValues(normalizeConfigFormRef.current(nextConfig));
      setShowApiKey(false);
      void refreshModelsRef.current?.();
    });
    void ensureDefaultConversationRef.current();
    void loadWorkflowRunsRef.current?.();
    void desktopAppClient.reloadAgents()
      .then(() => desktopAppClient.listAgents())
      .then((nextAgents) => {
        setAgents(nextAgents);
        void reloadWorkflowsRef.current?.();
      })
      .catch(() => {});
  }, [setAgents, setAppInfo, setConfig, setFormValues, setShowApiKey]);


  useEffect(() => {
    const unsubscribeToolConfirmation = desktopAppClient.onToolConfirmationRequested((request) => {
      onRequestScrollToBottomRef.current();
      applyConfirmationRequestRef.current(request);
    });
    const unsubscribeAgentStream = desktopAppClient.onAgentStream((event) => {
      // 工作流事件不进聊天会话处理（它们由 workflow stream 通道消费）
      if (event.workflow) {
        return;
      }

      // 预览事件先处理：它没有 streamMessageId，也可能在 run 收尾附近到达。
      // applyStreamDelta 内部按 conversationId 路由到对应桶，后台会话也能收到。
      if (event.filePreview) {
        applyStreamDeltaRef.current(event);
        return;
      }

      // 交互组件（ui_form）同样没有 streamMessageId，走同一条瞬时路由。
      if (event.uiWidget) {
        applyStreamDeltaRef.current(event);
        return;
      }

      // 工具调用卡片同样没有 streamMessageId，走同一条瞬时路由。
      if (event.toolInvocation) {
        applyStreamDeltaRef.current(event);
        return;
      }

      // done 事件也要路由（触发对应桶的缓冲冲刷），即便该会话不在前台
      if (event.done) {
        applyStreamDeltaRef.current(event);
        return;
      }

      if (!event.streamMessageId || (!event.deltaContent && !event.deltaReasoningContent)) {
        return;
      }

      applyStreamDeltaRef.current(event);
    });
    const unsubscribeWorkflowStream = desktopAppClient.onWorkflowStream((event) => {
      if (activeRunIdRef?.current && event.runId !== activeRunIdRef.current) {
        return;
      }

      applyWorkflowStreamRef.current?.(event);
    });

    return () => {
      unsubscribeToolConfirmation();
      unsubscribeAgentStream();
      unsubscribeWorkflowStream();
    };
  }, [activeRunIdRef, activeStreamAgentIdRef]);

}
