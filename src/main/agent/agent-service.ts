import { appendAgentAuditLog, appendMainLog } from '../core/audit-log';
import { cancelPendingConfirmation } from '../tools/confirmation-service';
import { DEFAULT_AGENT_ID } from '../../shared/agent-profile';
import { loadConfig } from '../core/config-service';
import { createChatCompletionStream, type ChatCompletionApiMessage, type ChatContentPart, type ImageContentPart } from './deepseek-client';
import { generateConversationTitle } from './title-generator';
import { injectTurnUserContent } from './turn-content';
import { executeToolCall, getCodeProjectTools, getRegisteredToolsByNames, getRegisteredToolsForAgent, setSubagentRunner, withoutSubagentTool } from '../tools/tool-registry';
import { compactToolMessageContent, parseToolMessageOk } from '../tools/tool-call-utils';
import { workflowMetrics } from '../workflow/workflow-metrics';
import { agentProfilesService } from '../agent-profiles/agent-profiles-service';
import { codeProjectsService } from '../code/code-projects-service';
import { conversationService } from '../conversation/conversation-service';
import { memoryService } from '../memory/memory-service';
import { extractExcelText, extractPdfText, extractPptText, extractWordText, readFile } from '../tools/system-tools';
import fs from 'node:fs/promises';
import { isSvgAttachment, type AttachmentMeta } from '../../shared/attachment';
import type { AgentConversationScope, AgentMessage, AgentResponse, AgentRunInput, AgentStreamEvent } from '../../shared/agent';
import type { ToolApprovalMode } from '../../shared/tools';
import type { WorkflowMessageMeta, WorkflowToolPolicy } from '../../shared/workflow';

function toDisplayContent(content: ChatCompletionApiMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    // 多模态工具结果（MCP 截图）：会话区只显示文本部分，图片走 filePreview 通道
    return content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
  }
  return '';
}

function toPublicMessages(messages: ChatCompletionApiMessage[]): AgentMessage[] {
  return messages
    .filter((message) => {
      if (message.role !== 'assistant') {
        return true;
      }

      const content = message.content;
      const text = typeof content === 'string' ? content.trim() : '';
      const hasToolCalls = (message.tool_calls?.length ?? 0) > 0;
      return text.length > 0 || !hasToolCalls;
    })
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: toDisplayContent(message.content),
      attachments: message.attachments,
      reasoning_content: message.reasoning_content,
      tool_call_id: message.tool_call_id,
      name: message.name,
    }));
}

function summarizePrompt(prompt: string) {
  return prompt.replace(/\s+/g, ' ').slice(0, 120);
}

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildSubagentSystemPrompt(role: string) {
  return [
    `你是一个子智能体（subagent），当前角色：${role}。`,
    '你被派发来独立完成一个子任务，请严格遵守以下约束：',
    '- 你看不到主智能体的对话历史，只能依据下面给出的子任务描述工作；不要假设未给出的上下文。',
    '- 不要编造事实。通过工具获得的信息必须标注来源；无法确认的内容必须明确标记为"待验证"。',
    '- 你不能再派发子智能体，请自己完成任务。',
    '- 你的输出会被原样交回主智能体，因此必须自包含：不要写"如上所述""见前文"这类指代。',
    '- 只输出结论与依据，不要复述子任务描述。',
  ].join('\n');
}

async function buildAttachmentProcessingPayload(attachments: AttachmentMeta[], signal: AbortSignal): Promise<{
  textContext: string;
  imageBlocks: ImageContentPart[];
}> {
  const sections: string[] = [];
  const imageBlocks: ImageContentPart[] = [];

  for (const [index, attachment] of attachments.entries()) {
    const targetPath = attachment.storedPath;
    if (!targetPath) {
      sections.push(`附件 ${index + 1}：${attachment.originalName}\n无法处理：缺少可读取路径。`);
      continue;
    }

    // SVG 虽归为 image，但部分模型供应商的 image_url 不支持它（UnsupportedImageFormat）。
    // 它本质是 XML 文本，降级走下面的文本提取分支：注入源码 + 绝对路径，模型可直接理解或自行 read_file。
    if (attachment.kind === 'image' && !isSvgAttachment(attachment)) {
      try {
        signal.throwIfAborted();
        const buffer = await fs.readFile(targetPath);
        const mimeType = attachment.mimeType?.startsWith('image/') ? attachment.mimeType : 'image/png';
        const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
        imageBlocks.push({ type: 'image_url', image_url: { url: dataUrl } });
        sections.push(`附件 ${index + 1}：${attachment.originalName}\n类型：image\n已作为图片直接发送给模型，请直接基于该图片进行识别与分析。`);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error('工具执行已取消。');
        }
        const message = error instanceof Error ? error.message : '未知错误';
        sections.push(`附件 ${index + 1}：${attachment.originalName}\n类型：image\n读取失败：${message}`);
      }
      continue;
    }

    const result = attachment.kind === 'pdf'
      ? await extractPdfText(targetPath, signal)
      : attachment.kind === 'word'
        ? await extractWordText(targetPath, signal)
        : attachment.kind === 'ppt'
          ? await extractPptText(targetPath, signal)
          : attachment.kind === 'excel'
            ? await extractExcelText(targetPath, undefined, signal)
            : await readFile(targetPath, signal);

    // svg 走到这里：kind 仍是 image，但内容是源码文本，标注为 svg 便于模型理解
    const typeLabel = isSvgAttachment(attachment) ? 'svg' : attachment.kind;
    sections.push(
      result.ok
        ? `附件 ${index + 1}：${attachment.originalName}\n类型：${typeLabel}\n绝对路径：${targetPath}\n提取结果：\n${result.content}`
        : `附件 ${index + 1}：${attachment.originalName}\n类型：${typeLabel}\n绝对路径：${targetPath}\n读取失败：${result.error ?? '未知错误'}`,
    );
  }

  const textContext = sections.length > 0
    ? `【附件预处理结果】\n${sections.join('\n\n')}\n\n以上"提取结果"就是这些附件的真实文件内容，已由系统读取并直接提供给你，你无需再调用读取类工具（如 read_file、read_excel）去重新读取它们，也不要怀疑其真实性或声称内容是你编造的。请直接基于以上内容进行总结、分析或回答，不要声称"没有看到附件"或"读不到文件"。\n\n注意：这条"无需再读取"只针对读取类工具，不影响其它工具。若任务需要生成文件、预览、执行命令等，仍应正常调用相应工具（如 create_text_draft、preview_image、preview_text、run_command 等），不要只在文字里声称已完成而不实际调用工具。`
    : '';


  return { textContext, imageBlocks };
}

const DEFAULT_CONVERSATION_KEY = 'default';

/**
 * 内置"代码分析"智能体的系统提示词。
 * Code 模式不使用用户自建的 agent 配置：工具集固定为只读的 code_*，提示词也随之内置，
 * 避免用户误挂上写文件或执行命令的能力。
 */
function buildCodeAgentSystemPrompt(project: { name: string; rootPath: string; writable: boolean; mcp: { enabledServerNames: string[] } }) {
  const readOnlyRules = [
    '- 你无法写文件、无法执行命令。需要修改代码时，请把改动以代码块形式给出，并说明目标文件与位置。',
  ];
  const writableRules = [
    '- 你还可以修改工程文件：`code_edit_file`（局部替换，首选）、`code_write_file`（新建或整体覆盖）。仍然不能执行命令。',
    '- 修改任何已有文件之前，必须先用 code_read_file 读过它；整体覆盖前必须完整读完。search 必须照抄读到的原文（含缩进）并在文件中唯一出现。',
    '- 每次写入都会弹出 diff 让用户确认，用户可能拒绝。被拒绝时不要反复重试同一处改动，先向用户说明意图。',
    '- 一次只改一处，改完说明改了什么；不要用整体覆盖来做小改动。',
    '- 单次 code_write_file 的 content 控制在约 300 行以内：更大的文件先写基础骨架，再用 code_edit_file 分段补充。超大的单次调用容易被模型网关损坏而整次丢失。',
    '- 禁止修改 .git/、node_modules/ 下的文件以及各类锁文件。',
  ];
  const mcpRules = project.mcp.enabledServerNames.length > 0
    ? [
        `- 本工程还接入了这些 MCP 服务：${project.mcp.enabledServerNames.join('、')}。它们的工具名以 mcp_ 开头，只用于服务对应的查询或操作，不要用它们替代 code_* 工具读写工程文件。`,
        '- 部分外部服务工具（写入、删除、发送类）会要求用户确认后才能执行。',
      ]
    : [];

  return [
    '你是一个代码分析智能体，负责阅读并解释用户已导入的代码工程。',
    `当前工程：${project.name}`,
    `工程根目录（绝对路径，仅供你理解上下文）：${project.rootPath}`,
    `当前工程权限：${project.writable ? '可读写' : '只读'}`,
    '',
    '工具使用规则：',
    '- 只读工具：code_list_dir（列目录）、code_glob（按文件名/路径检索）、code_grep（正则检索内容）、code_read_file（按行读取文件）。',
    '- 所有路径参数都必须是工程内相对路径，工程根用 "." 表示；不要传绝对路径，也不要尝试用 ../ 访问工程外的文件。',
    ...(project.writable ? writableRules : readOnlyRules),
    '- 用户配置的 Skill 也在你的工具列表里。调用某个 Skill 会返回它的说明文档，你需要按文档指引继续用现有工具完成任务；注意本模式下没有执行命令的能力，Skill 中要求跑脚本的步骤无法执行。',
    ...mcpRules,
    '- 文件较大时 code_read_file 会分页返回，请按提示的 startLine 继续读取，不要凭截断内容下结论。',
    '',
    '工作方式：',
    '- 先用 code_list_dir / code_glob 建立对工程结构的判断，再用 code_grep 定位关键实现，最后用 code_read_file 确认细节。',
    '- 回答中引用代码时必须给出 文件相对路径:行号，便于用户核对。',
    '- 没有实际读到的内容不要断言。检索无结果时说明已检索的范围与模式，而不是猜测实现。',
  ].join('\n');
}

type AgentStreamListener = (event: AgentStreamEvent) => void;

type AgentOneShotInput = {
  messages: ChatCompletionApiMessage[];
  systemPrompt?: string;
  agentId?: string;
  workflowMeta?: WorkflowMessageMeta;
  signal: AbortSignal;
  toolsPolicy?: WorkflowToolPolicy;
  onToolMessage?: (message: AgentMessage) => void;
  /** 子智能体嵌套深度，0 表示主智能体。透传给工具执行以阻断递归派发。 */
  depth?: number;
};

type AgentSubagentInput = {
  /** 自包含的子任务描述。子智能体看不到父级对话历史。 */
  task: string;
  role: string;
  label: string;
  agentId?: string;
  allowedToolNames: string[];
  depth: number;
  signal: AbortSignal;
  parentWorkflowMeta?: WorkflowMessageMeta;
  maxToolRounds?: number;
  maxToolCalls?: number;
  /** 工具审批模式。定时任务传 unattended-safe（low/medium 放行、high 拒绝）。 */
  approvalMode?: ToolApprovalMode;
  onToolMessage?: (message: AgentMessage) => void;
};

class AgentService {
  private messagesByConversation = new Map<string, ChatCompletionApiMessage[]>();
  private abortController: AbortController | null = null;
  /** 当前 run() 正在写入的会话 id。定时任务据此避让，避免与 run 收尾的整份落盘互相覆盖。 */
  private activeRunConversationId: string | null = null;
  /** 正在后台生成标题的会话，防止首轮完成与新请求完成之间的重复生成。 */
  private readonly pendingTitleConversations = new Set<string>();
  private streamListeners = new Set<AgentStreamListener>();

  onStream(listener: AgentStreamListener) {
    this.streamListeners.add(listener);
    return () => {
      this.streamListeners.delete(listener);
    };
  }

  private emitStreamEvent(event: AgentStreamEvent) {
    for (const listener of this.streamListeners) {
      listener(event);
    }
  }

  private getConversationKey(scope?: AgentConversationScope) {
    const agentId = scope?.agentId?.trim();
    return agentId ? `agent:${agentId}` : DEFAULT_CONVERSATION_KEY;
  }

  private getConversationMessagesForScope(scope?: AgentConversationScope) {
    const key = this.getConversationKey(scope);
    return this.messagesByConversation.get(key) ?? [];
  }

  private setConversationMessages(scope: AgentConversationScope | undefined, messages: ChatCompletionApiMessage[]) {
    const key = this.getConversationKey(scope);
    this.messagesByConversation.set(key, messages);
  }

  private resetConversationMessages(scope?: AgentConversationScope) {
    const key = this.getConversationKey(scope);
    this.messagesByConversation.delete(key);
  }

  async runOneShot(input: AgentOneShotInput): Promise<AgentMessage> {
    const config = await loadConfig();
    const toolsPolicy = input.toolsPolicy;
    const tools = toolsPolicy?.enabled ? await getRegisteredToolsByNames(toolsPolicy.allowedToolNames, input.agentId) : [];
    const workingMessages = input.systemPrompt
      ? ([{ role: 'system' as const, content: input.systemPrompt }, ...input.messages] satisfies ChatCompletionApiMessage[])
      : [...input.messages];
    const seenToolCalls = new Set<string>();
    const maxToolRounds = toolsPolicy?.enabled ? Math.max(1, toolsPolicy.maxToolRounds) : 1;
    const maxToolCalls = toolsPolicy?.enabled ? toolsPolicy.maxToolCalls : undefined;
    const metricsRunId = input.workflowMeta?.runId;
    let toolCallCount = 0;

    for (let round = 0; round < maxToolRounds; round += 1) {
      const assistantMessageId = createMessageId(input.workflowMeta?.actorId ? `assistant-${input.workflowMeta.actorId}-${round + 1}` : `assistant-workflow-${round + 1}`);
      if (metricsRunId) {
        workflowMetrics.addRequest(metricsRunId, workingMessages);
      }
      const assistantMessage = await createChatCompletionStream({
        config,
        messages: workingMessages,
        tools,
        signal: input.signal,
        onChunk: (event) => {
          if (metricsRunId) {
            workflowMetrics.addCompletionText(metricsRunId, event.deltaContent, event.deltaReasoningContent);
          }
          this.emitStreamEvent({
            agentId: input.agentId,
            streamMessageId: assistantMessageId,
            deltaContent: event.deltaContent,
            deltaReasoningContent: event.deltaReasoningContent,
            workflow: input.workflowMeta,
          });
        },
      });

      this.emitStreamEvent({ agentId: input.agentId, streamMessageId: assistantMessageId, done: true, workflow: input.workflowMeta });

      const assistantApiMessage: ChatCompletionApiMessage = {
        ...assistantMessage,
        id: assistantMessageId,
      };
      workingMessages.push(assistantApiMessage);

      const toolCalls = assistantMessage.tool_calls ?? [];
      await appendMainLog('INFO', `Workflow one-shot round=${round + 1} toolCalls=${toolCalls.length}`);

      if (!toolsPolicy?.enabled || toolCalls.length === 0) {
        return {
          id: assistantMessageId,
          role: 'assistant',
          content: assistantMessage.content ?? '',
          reasoning_content: assistantMessage.reasoning_content,
          workflow: input.workflowMeta,
        };
      }

      for (const toolCall of toolCalls) {
        if (maxToolCalls !== undefined && toolCallCount >= maxToolCalls) {
          if (toolsPolicy.forceSummarizeOnLimit) {
            return this.summarizeWorkflowToolLimit({
              config,
              messages: workingMessages,
              signal: input.signal,
              agentId: input.agentId,
              workflowMeta: input.workflowMeta,
              reason: `工具调用次数已达到上限（${maxToolCalls}）。`,
            });
          }
          throw new Error(`Workflow 工具调用次数超过限制（${maxToolCalls}）。`);
        }

        if (seenToolCalls.has(toolCall.id)) {
          throw new Error(`检测到重复 tool_call：${toolCall.id}`);
        }

        seenToolCalls.add(toolCall.id);
        toolCallCount += 1;
        const toolMessage = await executeToolCall(toolCall, input.signal, {
          agentId: input.agentId,
          allowedToolNames: toolsPolicy.allowedToolNames,
          requireConfirmation: toolsPolicy.requireConfirmation,
          approvalMode: toolsPolicy.approvalMode,
          depth: input.depth ?? 0,
          workflowMeta: input.workflowMeta,
        });
        // 工具结果可能是多模态数组（MCP 截图）：会话区只保留文本部分，图片经预览通道给用户
        const rawToolContent = toDisplayContent(toolMessage.content);
        const workflowToolMessage = {
          id: createMessageId(`tool-${toolCall.function.name}`),
          // 会话区只保留压缩后的结果；发给模型的 toolMessage 仍是完整内容
          content: compactToolMessageContent(rawToolContent),
          role: 'tool' as const,
          tool_call_id: toolMessage.tool_call_id,
          name: toolMessage.name,
          workflow: input.workflowMeta ? { ...input.workflowMeta, phase: 'tool_result' } : undefined,
        } satisfies AgentMessage;
        workingMessages.push(toolMessage);
        input.onToolMessage?.(workflowToolMessage);
        this.emitStreamEvent({
          agentId: input.agentId,
          streamMessageId: workflowToolMessage.id,
          deltaContent: workflowToolMessage.content,
          role: 'tool',
          workflow: workflowToolMessage.workflow,
        });
        this.emitStreamEvent({
          agentId: input.agentId,
          streamMessageId: workflowToolMessage.id,
          done: true,
          role: 'tool',
          workflow: workflowToolMessage.workflow,
        });
      }

      if (round === maxToolRounds - 1) {
        if (toolsPolicy.forceSummarizeOnLimit) {
          return this.summarizeWorkflowToolLimit({
            config,
            messages: workingMessages,
            signal: input.signal,
            agentId: input.agentId,
            workflowMeta: input.workflowMeta,
            reason: `工具调用轮数已达到上限（${maxToolRounds}）。`,
          });
        }
        throw new Error(`Workflow 工具调用轮数超过限制（${maxToolRounds}）。`);
      }
    }

    throw new Error('Workflow one-shot 执行未完成。');
  }

  private async summarizeWorkflowToolLimit(input: {
    config: Awaited<ReturnType<typeof loadConfig>>;
    messages: ChatCompletionApiMessage[];
    signal: AbortSignal;
    agentId?: string;
    workflowMeta?: WorkflowMessageMeta;
    reason: string;
  }): Promise<AgentMessage> {
    const assistantMessageId = createMessageId(input.workflowMeta?.actorId ? `assistant-${input.workflowMeta.actorId}-summary` : 'assistant-workflow-summary');
    const messages = [
      ...input.messages,
      {
        role: 'user' as const,
        content: `${input.reason}\n不要再调用工具。请基于已有工具结果输出最终总结，并明确说明哪些信息仍需验证。`,
      },
    ];
    const metricsRunId = input.workflowMeta?.runId;
    if (metricsRunId) {
      workflowMetrics.addRequest(metricsRunId, messages);
    }
    const assistantMessage = await createChatCompletionStream({
      config: input.config,
      messages,
      tools: [],
      signal: input.signal,
      onChunk: (event) => {
        if (metricsRunId) {
          workflowMetrics.addCompletionText(metricsRunId, event.deltaContent, event.deltaReasoningContent);
        }
        this.emitStreamEvent({
          agentId: input.agentId,
          streamMessageId: assistantMessageId,
          deltaContent: event.deltaContent,
          deltaReasoningContent: event.deltaReasoningContent,
          workflow: input.workflowMeta,
        });
      },
    });

    this.emitStreamEvent({ agentId: input.agentId, streamMessageId: assistantMessageId, done: true, workflow: input.workflowMeta });

    return {
      id: assistantMessageId,
      role: 'assistant',
      content: assistantMessage.content ?? '',
      reasoning_content: assistantMessage.reasoning_content,
      workflow: input.workflowMeta,
    };
  }

  /**
   * 子智能体执行原语：独立上下文、独立工具白名单、继承父级 AbortSignal。
   * 既供 run_subagent 工具（模型自行派发）使用，也供 workflow runner 直接并行调用。
   */
  async runSubagent(input: AgentSubagentInput): Promise<AgentMessage> {
    const allowedToolNames = withoutSubagentTool(input.allowedToolNames);
    const parentActorId = input.parentWorkflowMeta?.actorId;
    // 即使没有工作流上下文也要带上 workflow 元数据：
    // renderer 的聊天流处理会跳过带 workflow 的事件，避免子智能体的中间输出泄漏到主对话里。
    const workflowMeta: WorkflowMessageMeta = {
      ...input.parentWorkflowMeta,
      actorId: `${parentActorId ?? 'subagent'}:${input.label}`,
      actorRole: input.role,
      phase: 'subagent',
      subagent: {
        id: createMessageId('subagent'),
        label: input.label,
        depth: input.depth,
        parentActorId,
      },
    };

    await appendMainLog('INFO', `Subagent dispatched: role=${input.role} label=${input.label} depth=${input.depth} tools=${allowedToolNames.length}`);

    return this.runOneShot({
      messages: [{ role: 'user', content: input.task }],
      systemPrompt: buildSubagentSystemPrompt(input.role),
      agentId: input.agentId,
      workflowMeta,
      signal: input.signal,
      depth: input.depth,
      onToolMessage: input.onToolMessage,
      toolsPolicy: {
        enabled: allowedToolNames.length > 0,
        allowedToolNames,
        // 保持需要确认：低风险工具本来就会跳过弹窗，
        // 一旦白名单被放宽到中高风险工具，并行子智能体会失败而不是静默执行。
        requireConfirmation: true,
        approvalMode: input.approvalMode,
        maxToolRounds: input.maxToolRounds ?? 12,
        maxToolCalls: input.maxToolCalls ?? 60,
        forceSummarizeOnLimit: true,
      },
    });
  }

  async run(input: AgentRunInput): Promise<AgentResponse> {
    if (this.abortController) {
      throw new Error('已有请求正在执行，请稍后再试或先取消当前请求。');
    }

    const prompt = input.prompt.trim();
    const promptForModel = input.promptForModel?.trim() || prompt;
    const codeProjectId = input.codeProjectId?.trim();
    // 默认智能体实体化后，未指定智能体（且非 Code 模式）的会话统一落到 default 记录
    const agentId = codeProjectId ? input.agentId?.trim() : input.agentId?.trim() || DEFAULT_AGENT_ID;
    const conversationId = input.conversationId;

    if (!prompt) {
      throw new Error('请输入要发送的指令。');
    }

    const codeProject = codeProjectId ? codeProjectsService.getProject(codeProjectId) : null;
    if (codeProjectId && !codeProject) {
      throw new Error('找不到该代码工程，可能已被移除，请重新导入。');
    }

    const config = await loadConfig();
    const tools = codeProject
      ? await getCodeProjectTools(codeProject.writable, codeProject.mcp.enabledServerNames)
      : await getRegisteredToolsForAgent({ agentId });
    // 诊断：确认本次请求实际发给模型的工具集是否包含 email_* 工具，便于排查"模型说没有邮件工具"的问题。
    await appendMainLog(
      'INFO',
      `Agent tools prepared: agentId=${agentId ?? 'none'} codeMode=${Boolean(codeProject)} toolCount=${tools.length} hasEmailTools=${tools.some((tool) => tool.function.name.startsWith('email_'))}`,
    );
    const abortController = new AbortController();
    this.abortController = abortController;
    this.activeRunConversationId = conversationId;

    // Load persisted messages for this conversation
    const existingMessages = await conversationService.ensureMessagesLoaded(conversationId);
    const persistedAttachments = input.attachments?.map((attachment) => ({
      ...attachment.meta,
      storedPath: attachment.localPath,
    }));
    const { textContext: attachmentProcessingContext, imageBlocks } = persistedAttachments?.length
      ? await buildAttachmentProcessingPayload(persistedAttachments, abortController.signal)
      : { textContext: '', imageBlocks: [] as ImageContentPart[] };
    const basePromptForModel = attachmentProcessingContext
      ? `${promptForModel}${promptForModel ? '\n\n' : ''}${attachmentProcessingContext}`
      : promptForModel;
    const userContentForModel: string | ChatContentPart[] = imageBlocks.length > 0
      ? [
          { type: 'text' as const, text: basePromptForModel },
          ...imageBlocks,
        ]
      : basePromptForModel;
    const workingMessages: ChatCompletionApiMessage[] = [
      ...existingMessages,
      {
        id: createMessageId('user'),
        role: 'user' as const,
        content: prompt,
        attachments: persistedAttachments,
      },
    ];
    const seenToolCalls = new Set<string>();
    const summary = summarizePrompt(basePromptForModel);

    // Check if summarization is needed before sending to the API
    if (conversationService.shouldSummarize(conversationId, config.contextWindowSize)) {
      await conversationService.summarizeConversation(conversationId);
      // Reload messages after summarization
      const summarizedMessages = await conversationService.ensureMessagesLoaded(conversationId);
      workingMessages.length = 0;
      workingMessages.push(
        ...summarizedMessages,
        {
          id: createMessageId('user'),
          role: 'user' as const,
          content: prompt,
          attachments: persistedAttachments,
        },
      );
    }

    let selectedAgentContent: string | null = null;
    if (codeProject) {
      selectedAgentContent = buildCodeAgentSystemPrompt(codeProject);
    } else if (agentId) {
      const selectedAgent = agentProfilesService.getAgentDetail(agentId);
      if (selectedAgent) {
        selectedAgentContent = selectedAgent.content;
      } else {
        await appendMainLog('ERROR', `Selected agent profile not found: ${agentId}`);
      }
    }

    // 记忆注入：按本轮输入检索全局长期记忆，拼进系统提示（每轮一次，在循环外算好）。Code 模式不注入。
    let memorySystemBlock = '';
    if (!codeProject && config.memoryEnabled) {
      memorySystemBlock = await memoryService.getPromptBlock(basePromptForModel);
    }
    const systemContent = [selectedAgentContent, memorySystemBlock].filter(Boolean).join('\n\n') || null;

    // 本轮用户消息 id：预览卡片挂在它之后。消息 id 会随本轮消息一起落盘，
    // 所以会话重载后 renderer 仍能把这个 id 对回同一条用户消息。
    const lastWorkingMessage = workingMessages[workingMessages.length - 1];
    const turnUserId = lastWorkingMessage?.role === 'user' ? lastWorkingMessage.id : undefined;

    // 先把本轮用户消息落盘，再进入模型调用循环：请求等待期间用户可能切到别的会话再切回，
    // 切回会从磁盘重载消息；若此时用户输入尚未落盘（原来只在收尾统一落盘），最后一条输入会丢失。
    await conversationService.setMessages(conversationId, workingMessages);

    await appendMainLog('INFO', `Agent request started: ${summary}`);
    await appendAgentAuditLog({
      timestamp: new Date().toISOString(),
      status: 'started',
      summary,
      detail: '收到新的 Agent 请求。',
    });

    try {
      for (let round = 0; round < config.maxToolRounds; round += 1) {
        const assistantMessageId = createMessageId(`assistant-${round + 1}`);
        // 按本轮用户消息 id 注入多模态/附件内容，而不是"最后一条"：
        // 一旦发生工具调用，末尾会变成 tool 消息，若按位置注入则第 2 轮起图片/附件就从上下文丢失，
        // 模型会误以为"只收到文字"。按 id 匹配可让附件内容贯穿本轮任务的所有轮次。
        const modelMessages = injectTurnUserContent(workingMessages, turnUserId, userContentForModel);
        const requestMessages = systemContent
          ? ([{ role: 'system' as const, content: systemContent }, ...modelMessages] satisfies ChatCompletionApiMessage[])
          : modelMessages;

        const assistantMessage = await createChatCompletionStream({
          config,
          messages: requestMessages,
          tools,
          signal: abortController.signal,
          onChunk: (event) => {
            this.emitStreamEvent({
              agentId,
              conversationId,
              streamMessageId: assistantMessageId,
              deltaContent: event.deltaContent,
              deltaReasoningContent: event.deltaReasoningContent,
            });
          },
        });
        this.emitStreamEvent({ agentId, conversationId, streamMessageId: assistantMessageId, done: true });

        workingMessages.push({
          ...assistantMessage,
          id: assistantMessageId,
        });

        const toolCalls = assistantMessage.tool_calls ?? [];
        await appendMainLog('INFO', `Model response round=${round + 1} toolCalls=${toolCalls.length}`);

        if (toolCalls.length === 0) {
          // Persist all working messages to disk
          await conversationService.setMessages(conversationId, workingMessages);

          // 后台抽取长期记忆：与标题生成一样 fire-and-forget，内部自带节流与异常吞噬，不阻塞收尾。
          if (!codeProject && config.memoryEnabled) {
            void memoryService.maybeExtractAndStore({
              conversationId,
              userText: prompt,
              recentMessages: workingMessages.slice(-8),
            });
          }

          // Update conversation title from a model summary of the first round if still default.
          // 后台执行不阻塞 run() 返回：模型调用可能耗时数秒，必须及时释放 abortController，
          // 否则会拉长"已有请求正在执行"的窗口并推迟 isRunning 结束。完成后经 conversation:changed 推送给 renderer。
          const meta = conversationService.getConversationMeta(conversationId);
          if (meta && meta.title === '新会话' && !this.pendingTitleConversations.has(conversationId)) {
            this.pendingTitleConversations.add(conversationId);
            void generateConversationTitle(prompt, assistantMessage.content ?? '')
              .then(async (title) => {
                await conversationService.updateConversationTitle(conversationId, title);
              })
              .catch((error) => {
                void appendMainLog('ERROR', `Failed to update conversation title: ${error instanceof Error ? error.message : 'Unknown error'}`);
              })
              .finally(() => {
                this.pendingTitleConversations.delete(conversationId);
              });
          }

          await appendMainLog('INFO', 'Agent request finished without tool calls.');
          await appendAgentAuditLog({
            timestamp: new Date().toISOString(),
            status: 'success',
            summary,
            detail: assistantMessage.content ?? '模型已返回回复。',
          });

          return {
            reply: assistantMessage.content ?? '',
            messages: toPublicMessages(workingMessages),
            toolCalls: [],
          };
        }

        for (const toolCall of toolCalls) {
          if (seenToolCalls.has(toolCall.id)) {
            throw new Error(`检测到重复 tool_call：${toolCall.id}`);
          }

          seenToolCalls.add(toolCall.id);
          // 工具执行前推一张"执行中"卡片；执行后按同一 toolCallId 原地更新为成功/失败。
          // 走瞬时通道（不进 messages、不落盘、不发给模型）。assistantMessageId 是发出
          // tool_calls 的那一轮流式消息 id，renderer 据此把卡片按时序插在该助手消息之后。
          const invocationBase = {
            turnUserId,
            assistantMessageId,
            toolCallId: toolCall.id,
            name: toolCall.function.name,
          };
          this.emitStreamEvent({
            agentId,
            conversationId,
            toolInvocation: {
              ...invocationBase,
              argsSummary: toolCall.function.arguments.replace(/\s+/g, ' ').slice(0, 200),
              status: 'running',
            },
          });
          const toolMessage = await executeToolCall(toolCall, abortController.signal, {
            agentId,
            codeProjectId,
            conversationId,
            // 预览载荷不进消息历史：直接经流事件推到聊天会话区，由 renderer 瞬时渲染。
            // 带上本轮用户消息 id，renderer 才能把卡片归位到"这一轮"（用户消息之后、助手回复之前）。
            onFilePreview: (payload) => this.emitStreamEvent({ agentId, conversationId, filePreview: { ...payload, turnUserId } }),
            // 交互组件（ui_form）同样走瞬时通道并按本轮用户消息 id 归位。
            onUiWidget: (payload) => this.emitStreamEvent({ agentId, conversationId, uiWidget: { ...payload, turnUserId } }),
          });
          workingMessages.push(toolMessage);

          const toolResultContent = toDisplayContent(toolMessage.content);
          const toolResultOk = parseToolMessageOk(toolResultContent);
          this.emitStreamEvent({
            agentId,
            conversationId,
            toolInvocation: {
              ...invocationBase,
              status: toolResultOk === false ? 'error' : 'success',
              ok: toolResultOk,
              resultContent: compactToolMessageContent(toolResultContent),
            },
          });
        }

        if (round === config.maxToolRounds - 1) {
          throw new Error(`工具调用轮数超过限制（${config.maxToolRounds}）。`);
        }
      }

      throw new Error('Agent 执行未完成。');
    } catch (error) {
      if (abortController.signal.aborted) {
        await appendMainLog('INFO', 'Agent request cancelled.');
        await appendAgentAuditLog({
          timestamp: new Date().toISOString(),
          status: 'cancelled',
          summary,
          detail: '当前请求已取消。',
        });
        throw new Error('当前请求已取消。');
      }

      const message = error instanceof Error ? error.message : 'Agent 执行失败。';
      await appendMainLog('ERROR', `Agent request failed: ${message}`);
      await appendAgentAuditLog({
        timestamp: new Date().toISOString(),
        status: 'error',
        summary,
        detail: message,
      });
      throw error;
    } finally {
      this.abortController = null;
      this.activeRunConversationId = null;
    }
  }

  /** 该会话是否正被用户请求占用。定时任务在忙碌时延后触发，避免并发写同一会话。 */
  isConversationBusy(conversationId: string) {
    return this.abortController !== null && this.activeRunConversationId === conversationId;
  }

  cancel() {
    const hasActiveRequest = Boolean(this.abortController);
    this.abortController?.abort();
    this.abortController = null;
    this.activeRunConversationId = null;
    cancelPendingConfirmation();

    return { cancelled: hasActiveRequest };
  }

  /** @deprecated Use conversationService.resetConversation() instead */
  reset(scope?: AgentConversationScope) {
    this.resetConversationMessages(scope);
  }

  /** @deprecated Use conversationService.ensureMessagesLoaded() instead */
  getMessages(scope?: AgentConversationScope) {
    return toPublicMessages(this.getConversationMessagesForScope(scope));

  }

  async getConversationMessages(conversationId: string): Promise<AgentMessage[]> {
    const messages = await conversationService.getAllMessages(conversationId);
    return toPublicMessages(messages);
  }

  async resetConversationById(conversationId: string): Promise<void> {
    await conversationService.resetConversation(conversationId);
  }
}

export const agentService = new AgentService();

// 把子智能体执行器注入 tool-registry，让 run_subagent 工具可用。
// 走注入而非直接 import，避免 tool-registry -> agent-service -> tool-registry 循环依赖。
setSubagentRunner(async (input) => {
  const message = await agentService.runSubagent(input);
  return message.content;
});
