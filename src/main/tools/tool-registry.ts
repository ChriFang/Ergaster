import { z } from 'zod';
import { appendMainLog, appendToolAuditLog } from '../core/audit-log';
import { clipLogText } from './tool-helpers';
import { shouldAutoExecute, resolveUnattendedApproval } from './auto-execute';
import { requestToolConfirmation } from './confirmation-service';
import { evaluateCommandAutoRun, extractCommandPrefix, summarizeCommand } from './command-allowlist';
import type { CommandAutoRunResult } from './command-allowlist';
import {
  allowedApplicationNames,
  availablePowershellTemplates,
  createDocxDraft,
  createExcelDraft,
  createImageDraft,
  createPdfDraft,
  createTextDraft,
  extractExcelText,
  extractPdfText,
  extractPptText,
  extractWordText,
  getSystemInfo,
  getCommandToolDescription,
  httpRequest,
  listDraftFiles,
  moveDraftFile,
  openApplication,
  openPath,
  readFile,
  listDirectory,
  grepFiles,
  globFiles,
  countMatches,
  extractArchive,
  downloadFile,
  runCommand,
  runPowershellTemplate,
  getCommandRuntimeLabel,
  searchFiles,
  updateExcelCells,
} from './system-tools';
import { documentBlocksSchema } from './document-utils';
import { previewDocxFile, previewImageFile, previewTextFile } from './preview-tools';
import { uiFormTool } from './ui-form-tools';
import { renderUiTool } from './ui-html-tools';
import { memoryTools, MEMORY_AUTO_APPROVED_TOOL_NAMES } from './memory-tools';
import { getAllCapabilityTools, getEnabledCapabilityTools } from '../capabilities/capability-registry';
import { scheduledTaskTools, scheduledTaskToolNames } from './scheduled-task-tools';
import { userSkillsService } from '../skills/user-skills-service';
import { prepareInstall, commitInstall } from '../skills/skill-installer';
import { agentProfilesService } from '../agent-profiles/agent-profiles-service';
import { codeProjectsService } from '../code/code-projects-service';
import { codeGlob, codeGrep, codeListDir, codeReadFile, codeEditFile, codeWriteFile, prepareCodeEditFile, prepareCodeWriteFile, type CodeWriteContext } from '../code/code-tools';
import { maxGlobResults, maxGrepResults, maxReadLines, maxWriteBytes } from '../code/code-tools-utils';
import { mcpService } from '../mcp/mcp-service';
import { loadConfig, appendAutoExecuteTool } from '../core/config-service';
import {
  emailListMailboxes,
  emailListMailboxesSchema,
  emailListMessages,
  emailListMessagesSchema,
  emailMarkRead,
  emailMarkReadSchema,
  emailMarkUnread,
  emailMarkUnreadSchema,
  emailReadMessage,
  emailReadMessageSchema,
  emailSearch,
  emailSearchSchema,
} from '../mail/mail-tools';
import { extractBase64ImagesFromText, maxToolResultImages, toToolMessage } from './tool-call-utils';
import { resolveDownloadApproval, type DownloadApproval } from './download-engine';
import { DEFAULT_AGENT_ID } from '../../shared/agent-profile';
import type { ChatCompletionTool, FilePreviewPayload, ToolCall } from '../../shared/agent';
import type { UiWidgetPayload } from '../../shared/ui-form';
import { codeToolTimeoutMs, commandToolTimeoutMs, defaultToolTimeoutMs, downloadToolName, subagentToolTimeoutMs } from '../../shared/tools';
import type { ToolApprovalMode, ToolContext, ToolDefinition, ToolResult, ToolSchemaShape } from '../../shared/tools';
import { maxSubagentDepth } from '../../shared/workflow';
import type { WorkflowMessageMeta } from '../../shared/workflow';
import type { UserSkillDefinition } from '../../shared/user-skills';
import type { ChatCompletionApiMessage } from '../agent/deepseek-client';
import { toChatCompletionTool } from '../agent/chat-completion-tools';

const openApplicationSchema = z.object({
  appName: z.enum(allowedApplicationNames),
});

const openPathSchema = z.object({
  targetPath: z.string().min(1).max(260),
});

const getSystemInfoSchema = z.object({});

const searchFilesSchema = z.object({
  keyword: z.string().min(1).max(100),
  limit: z.number().int().min(1).max(20).optional().default(10),
});

const listDirSchema = z.object({
  dirPath: z.string().min(1).max(1024),
  recursive: z.boolean().optional().default(false),
});

const grepFilesSchema = z.object({
  dirPath: z.string().min(1).max(1024),
  pattern: z.string().min(1).max(2000),
  include: z.array(z.string().max(200)).max(20).optional(),
  exclude: z.array(z.string().max(200)).max(20).optional(),
  contextLines: z.number().int().min(0).max(10).optional().default(2),
  caseInsensitive: z.boolean().optional().default(false),
  maxResults: z.number().int().min(1).max(maxGrepResults).optional().default(50),
});

const globFilesSchema = z.object({
  dirPath: z.string().min(1).max(1024),
  pattern: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(maxGlobResults).optional().default(100),
});

const countMatchesSchema = z.object({
  dirPath: z.string().min(1).max(1024),
  pattern: z.string().min(1).max(2000),
  include: z.array(z.string().max(200)).max(20).optional(),
  exclude: z.array(z.string().max(200)).max(20).optional(),
  caseInsensitive: z.boolean().optional().default(false),
});

const extractArchiveSchema = z.object({
  archivePath: z.string().min(1).max(1024),
  destDir: z.string().min(1).max(1024),
});

const downloadFileSchema = z.object({
  url: z.string().min(1).max(4096),
  destDir: z.string().min(1).max(1024).optional(),
  fileName: z.string().min(1).max(200).optional(),
});

/** 从下载链接里取主机名（仅用于确认卡展示；真正的校验在 resolveDownloadApproval）。 */
function getDownloadHost(url: string): string {
  try {
    return new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return '';
  }
}

const createTextDraftSchema = z.object({
  fileName: z.string().min(1).max(120),
  content: z.string().max(100000),
});

const createImageDraftSchema = z.object({
  fileName: z.string().min(1).max(120),
  base64Data: z.string().min(8).max(14_000_000),
});

const createDocumentDraftSchema = z.object({
  fileName: z.string().min(1).max(120),
  blocks: documentBlocksSchema,
});

const runPowershellTemplateSchema = z.object({
  templateName: z.enum(availablePowershellTemplates),
});

const httpRequestSchema = z.object({
  url: z.string().min(1).max(2048),
  query: z.record(z.string().max(500)).refine((value) => Object.keys(value).length <= 20, 'query 参数数量不能超过 20 个').optional(),
  headers: z.record(z.string().max(500)).refine((value) => Object.keys(value).length <= 20, 'headers 数量不能超过 20 个').optional(),
});

const installSkillSchema = z.object({
  source: z.string().min(1).max(2048),
});

const readFileSchema = z.object({
  filePath: z.string().min(1).max(260),
  startLine: z.number().int().min(1).optional(),
  maxLines: z.number().int().min(1).max(maxReadLines).optional(),
});

const extractPdfTextSchema = z.object({
  filePath: z.string().min(1).max(260),
});

const extractWordTextSchema = z.object({
  filePath: z.string().min(1).max(260),
});

const extractPptTextSchema = z.object({
  filePath: z.string().min(1).max(260),
});

const previewFilePathSchema = z.object({
  filePath: z.string().min(1).max(260),
});

const readExcelSchema = z.object({
  filePath: z.string().min(1).max(260),
  sheetName: z.string().max(120).optional(),
  startRow: z.number().int().min(1).max(1000000).optional(),
  maxRows: z.number().int().min(1).max(200).optional(),
});

const createExcelDraftSchema = z.object({
  fileName: z.string().min(1).max(120),
  sheets: z.array(z.object({
    name: z.string().min(1).max(31),
    rows: z.array(z.array(z.string().max(1000)).max(50)).min(1).max(2000),
  })).min(1).max(10),
});

const updateExcelCellsSchema = z.object({
  filePath: z.string().min(1).max(260),
  sheetName: z.string().max(120),
  updates: z.array(z.object({
    cell: z.string().min(2).max(10),
    value: z.string().max(1000),
  })).min(1).max(200),
  outputFileName: z.string().max(120).optional(),
});

const moveDraftFileSchema = z.object({
  fileName: z.string().min(1).max(200),
  newFileName: z.string().min(1).max(200),
});

const listDraftFilesSchema = z.object({
  subDirectory: z.string().max(200).optional(),
  keyword: z.string().max(120).optional(),
});




const runCommandSchema = z.object({
  command: z.string().trim().min(1).max(4000),
});

const codeProjectPathSchema = z.string().max(1024);

const codeListDirSchema = z.object({
  dirPath: codeProjectPathSchema.optional(),
  recursive: z.boolean().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

const codeReadFileSchema = z.object({
  filePath: codeProjectPathSchema.min(1),
  startLine: z.number().int().min(1).max(10_000_000).optional(),
  maxLines: z.number().int().min(1).max(maxReadLines).optional(),
});

const codeGlobSchema = z.object({
  pattern: z.string().trim().min(1).max(500),
  dirPath: codeProjectPathSchema.optional(),
  limit: z.number().int().min(1).max(maxGlobResults).optional(),
});

const codeGrepSchema = z.object({
  pattern: z.string().min(1).max(1000),
  dirPath: codeProjectPathSchema.optional(),
  include: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  exclude: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  contextLines: z.number().int().min(0).max(10).optional(),
  caseInsensitive: z.boolean().optional(),
  maxResults: z.number().int().min(1).max(maxGrepResults).optional(),
});

const codeWriteFileSchema = z.object({
  filePath: codeProjectPathSchema.min(1),
  content: z.string().max(maxWriteBytes),
});

const codeEditFileSchema = z.object({
  filePath: codeProjectPathSchema.min(1),
  search: z.string().min(1).max(maxWriteBytes),
  replace: z.string().max(maxWriteBytes),
});

export const subagentToolName = 'run_subagent';

const runSubagentSchema = z.object({
  task: z.string().trim().min(1).max(8000),
  role: z.string().trim().min(1).max(200),
  label: z.string().trim().max(120).optional(),
  allowed_tools: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
});

export type SubagentRunnerInput = {
  task: string;
  role: string;
  label: string;
  agentId?: string;
  allowedToolNames: string[];
  depth: number;
  signal: AbortSignal;
  parentWorkflowMeta?: WorkflowMessageMeta;
};

export type SubagentRunner = (input: SubagentRunnerInput) => Promise<string>;

let subagentRunner: SubagentRunner | null = null;

/**
 * 由 agent-service 在模块加载时装配。
 * 用注入而不是直接 import，是为了避免 tool-registry 与 agent-service 形成循环依赖。
 */
export function setSubagentRunner(runner: SubagentRunner) {
  subagentRunner = runner;
}

/** 子智能体自身的工具白名单：剔除派发工具，防止递归套娃。 */
export function withoutSubagentTool(toolNames: string[]) {
  return toolNames.filter((name) => name !== subagentToolName);
}

const registeredTools: ToolDefinition<unknown>[] = [
  {
    name: 'open_application',
    description: `打开白名单应用，仅允许：${allowedApplicationNames.join('、')}`,
    risk: 'medium',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        appName: {
          type: 'string',
          enum: allowedApplicationNames,
          description: '要打开的白名单应用名称',
        },
      },
      required: ['appName'],
      additionalProperties: false,
    },
    validator: openApplicationSchema,
    source: { type: 'system' },
    execute: async (args) => {
      const input = args as z.infer<typeof openApplicationSchema>;
      return openApplication(input.appName);
    },
  },
  {
    name: 'open_path',
    description: '打开允许目录内的文件或文件夹。',
    risk: 'medium',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        targetPath: {
          type: 'string',
          description: '要打开的目标路径，必须位于允许目录内',
        },
      },
      required: ['targetPath'],
      additionalProperties: false,
    },
    validator: openPathSchema,
    source: { type: 'system' },
    execute: async (args) => {
      const input = args as z.infer<typeof openPathSchema>;
      return openPath(input.targetPath);
    },
  },
  {
    name: 'read_file',
    description: '读取允许目录内的文本文件内容，适用于附件路径或本地文件路径。默认整读（上限 1MB）；传 startLine/maxLines 可按行分页读取，大文件（最大 100MB）也会自动切换为流式分页模式并提示下一页的 startLine。分析大日志等场景应使用分页读取。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '要读取的文本文件路径；当当前消息已经列出附件或明确给出本地文件路径时，应优先直接读取该路径',
        },
        startLine: {
          type: 'integer',
          description: '起始行号，从 1 开始；传入即进入分页模式，适合读取大文件片段',
        },
        maxLines: {
          type: 'integer',
          description: `本次最多读取的行数，范围 1 到 ${maxReadLines}；分页模式下默认 200`,
        },
      },
      required: ['filePath'],
      additionalProperties: false,
    },
    validator: readFileSchema,
    source: { type: 'system' },
    execute: async (args, context) => {
      const input = args as z.infer<typeof readFileSchema>;
      return readFile(input.filePath, context.signal, { startLine: input.startLine, maxLines: input.maxLines });
    },
  },
  {
    name: 'extract_pdf_text',
    description: '提取当前消息中已经明确给出的 PDF 文件路径的文本内容。遇到 PDF 附件或本地 PDF 路径时，应优先使用此工具，而不是仅凭自然语言猜测内容。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '要提取文本的 PDF 文件路径；当当前消息列出了 PDF 附件路径时，应直接使用该路径',
        },
      },
      required: ['filePath'],
      additionalProperties: false,
    },
    validator: extractPdfTextSchema,
    source: { type: 'system' },
    execute: async (args, context) => {
      const input = args as z.infer<typeof extractPdfTextSchema>;
      return extractPdfText(input.filePath, context.signal);
    },
  },
  {
    name: 'extract_word_text',
    description: '提取当前消息中已经明确给出的 .docx 文件路径的文本内容。遇到 Word 附件（.docx）或本地 .docx 路径时，应优先使用此工具，而不是仅凭自然语言猜测内容。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '要提取文本的 .docx 文件路径；当当前消息列出了 Word 附件路径时，应直接使用该路径',
        },
      },
      required: ['filePath'],
      additionalProperties: false,
    },
    validator: extractWordTextSchema,
    source: { type: 'system' },
    execute: async (args, context) => {
      const input = args as z.infer<typeof extractWordTextSchema>;
      return extractWordText(input.filePath, context.signal);
    },
  },
  {
    name: 'extract_ppt_text',
    description: '提取当前消息中已经明确给出的 .pptx 文件路径的文本内容（按幻灯片页码顺序）。遇到 PowerPoint 附件（.pptx）或本地 .pptx 路径时，应优先使用此工具，而不是仅凭自然语言猜测内容。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '要提取文本的 .pptx 文件路径；当当前消息列出了 PowerPoint 附件路径时，应直接使用该路径',
        },
      },
      required: ['filePath'],
      additionalProperties: false,
    },
    validator: extractPptTextSchema,
    source: { type: 'system' },
    execute: async (args, context) => {
      const input = args as z.infer<typeof extractPptTextSchema>;
      return extractPptText(input.filePath, context.signal);
    },
  },
  {
    name: 'read_excel',
    description: '读取 Excel（.xlsx/.xlsm）或 CSV 文件内容。首次调用请不要传 sheetName，工具会返回工作表清单及各表行列数与首行；确认目标工作表后再带上 sheetName 获取数据。数据量大时用 startRow / maxRows 分页，返回结果会提示下一页的 startRow。遇到 Excel/CSV 附件或本地路径时必须使用此工具获取真实数据，不要凭猜测编造内容。公式单元格返回的是文件保存时的缓存值，不会重新计算。旧版 .xls 不支持。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '要读取的 .xlsx / .xlsm / .csv 文件路径；当当前消息列出了附件绝对路径时，应直接使用该路径',
        },
        sheetName: {
          type: 'string',
          description: '要读取的工作表名称；省略时只返回工作表清单概览而不返回数据。CSV 文件忽略此参数',
        },
        startRow: {
          type: 'integer',
          description: '起始行号，从 1 开始，默认 1；用于翻页读取大表',
        },
        maxRows: {
          type: 'integer',
          description: '本次最多返回的行数，范围 1 到 200，默认 200',
        },
      },
      required: ['filePath'],
      additionalProperties: false,
    },
    validator: readExcelSchema,
    source: { type: 'system' },
    execute: async (args, context) => {
      const input = args as z.infer<typeof readExcelSchema>;
      return extractExcelText(
        input.filePath,
        { sheetName: input.sheetName, startRow: input.startRow, maxRows: input.maxRows },
        context.signal,
      );
    },
  },

  {
    name: 'get_system_info',
    description: '返回当前系统的只读信息，包括平台、版本、CPU、内存和用户名。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    validator: getSystemInfoSchema,
    source: { type: 'system' },
    execute: async () => getSystemInfo(),
  },
  {
    name: 'search_files',
    description: '在预设安全目录中搜索文件名。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: '搜索关键词，将匹配文件或文件夹名称',
        },
        limit: {
          type: 'integer',
          description: '最多返回结果条数，范围 1 到 20，默认 10',
        },
      },
      required: ['keyword'],
      additionalProperties: false,
    },
    validator: searchFilesSchema,
    source: { type: 'system' },
    execute: async (args, context) => {
      const input = args as z.infer<typeof searchFilesSchema>;
      return searchFiles(input.keyword, input.limit, context.signal);
    },
  },
  {
    name: 'list_dir',
    description: '列出允许访问目录内某个目录的子项（名称、目录/文件、大小、修改时间）。默认只列直接子项；recursive=true 时递归列出（自动跳过 node_modules、.git 等目录，有数量上限）。用于查看目录结构，无需借助命令行。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        dirPath: {
          type: 'string',
          description: '要列出的目录路径，必须位于允许访问的目录范围内',
        },
        recursive: {
          type: 'boolean',
          description: '是否递归列出所有子目录，默认 false',
        },
      },
      required: ['dirPath'],
      additionalProperties: false,
    },
    validator: listDirSchema,
    source: { type: 'system' },
    execute: async (args, context) => {
      const input = args as z.infer<typeof listDirSchema>;
      return listDirectory(input.dirPath, context.signal, { recursive: input.recursive });
    },
  },
  {
    name: 'glob_files',
    description: '在允许访问的目录内按 glob 模式递归查找文件，例如 "*.txt"、"**/*.log"、"logs__*2026_10_07*.txt"。不含 "/" 的模式按文件名匹配，含 "/" 的模式按相对路径匹配。每个结果附带文件大小（bytes），便于按时段/大小挑文件。替代用命令行跑 Get-ChildItem -Recurse + Where-Object 的做法，无需审批。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        dirPath: { type: 'string', description: '检索根目录，必须位于允许访问的目录范围内' },
        pattern: { type: 'string', description: 'glob 模式，支持 **、* 与 ?' },
        limit: { type: 'integer', description: `最多返回多少个文件，默认 100，上限 ${maxGlobResults}` },
      },
      required: ['dirPath', 'pattern'],
      additionalProperties: false,
    },
    validator: globFilesSchema,
    source: { type: 'system' },
    execute: async (args, context) => {
      const input = args as z.infer<typeof globFilesSchema>;
      return globFiles(input, context.signal);
    },
  },
  {
    name: 'grep_files',
    description: '在允许访问的目录内按正则表达式递归检索文件内容，返回命中行及上下文。可用 include/exclude 的 glob 限定文件范围。跳过二进制文件；超过 100MB 的文件会被跳过并在结果中提示（可改用 read_file 分页读取）。替代用命令行跑 Select-String 的做法，无需审批，适合在日志目录里搜关键字。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        dirPath: { type: 'string', description: '检索根目录，必须位于允许访问的目录范围内' },
        pattern: { type: 'string', description: '正则表达式（JavaScript 语法）' },
        include: { type: 'array', description: '只检索匹配这些 glob 的文件，如 ["*.txt","*.log"]', items: { type: 'string' } },
        exclude: { type: 'array', description: '排除匹配这些 glob 的文件', items: { type: 'string' } },
        contextLines: { type: 'integer', description: '每处命中输出的上下文行数，默认 2，上限 10' },
        caseInsensitive: { type: 'boolean', description: '是否忽略大小写，默认 false' },
        maxResults: { type: 'integer', description: `最多返回多少处命中，默认 50，上限 ${maxGrepResults}` },
      },
      required: ['dirPath', 'pattern'],
      additionalProperties: false,
    },
    validator: grepFilesSchema,
    timeoutMs: codeToolTimeoutMs,
    source: { type: 'system' },
    execute: async (args, context) => {
      const input = args as z.infer<typeof grepFilesSchema>;
      return grepFiles(input, context.signal);
    },
  },
  {
    name: 'count_matches',
    description: '在允许访问的目录内跨文件统计正则命中的行数，按文件分组返回每文件命中数与总数，不返回每行内容。替代命令行里 Select-String | Measure-Object / Group-Object 的聚合统计，适合先摸清日志里某关键字的分布与规模。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        dirPath: { type: 'string', description: '检索根目录，必须位于允许访问的目录范围内' },
        pattern: { type: 'string', description: '正则表达式（JavaScript 语法）' },
        include: { type: 'array', description: '只统计匹配这些 glob 的文件', items: { type: 'string' } },
        exclude: { type: 'array', description: '排除匹配这些 glob 的文件', items: { type: 'string' } },
        caseInsensitive: { type: 'boolean', description: '是否忽略大小写，默认 false' },
      },
      required: ['dirPath', 'pattern'],
      additionalProperties: false,
    },
    validator: countMatchesSchema,
    timeoutMs: codeToolTimeoutMs,
    source: { type: 'system' },
    execute: async (args, context) => {
      const input = args as z.infer<typeof countMatchesSchema>;
      return countMatches(input, context.signal);
    },
  },
  {
    name: 'extract_archive',
    description: '把允许访问目录内的 .zip 压缩包解压到允许访问目录内的目标目录（目标目录不存在会自动创建）。会对条目做路径消毒防止逃逸，并有文件数/单文件/总量上限。替代用命令行 Expand-Archive / Remove-Item 的做法；用于下载的日志/数据包落地后解压。注意：这是写文件操作。',
    risk: 'medium',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        archivePath: { type: 'string', description: '.zip 压缩包路径，必须位于允许访问的目录范围内' },
        destDir: { type: 'string', description: '解压目标目录，必须位于允许访问的目录范围内；不存在则自动创建' },
      },
      required: ['archivePath', 'destDir'],
      additionalProperties: false,
    },
    validator: extractArchiveSchema,
    timeoutMs: codeToolTimeoutMs,
    source: { type: 'system' },
    execute: async (args, context) => {
      const input = args as z.infer<typeof extractArchiveSchema>;
      return extractArchive(input, context.signal);
    },
  },
  {
    name: downloadToolName,
    description: '把 http/https 链接指向的文件下载到本地（默认草稿目录下的 downloads/，也可指定允许访问目录内的 destDir）。用于下载日志包、数据文件等落盘后再分析；下载 .zip 后可接着用 extract_archive 解压。会拦截内网/回环地址，单文件上限 500MB，同名文件不会被覆盖；不允许下载 .exe/.bat/.ps1/.js 等可执行文件。下载文件落盘必须用本工具，不要用 run_command 跑 Invoke-WebRequest / curl。域名不在下载白名单内时需要用户确认一次。',
    risk: 'medium',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要下载的 http/https 链接' },
        destDir: { type: 'string', description: '保存目录，必须位于允许访问的目录范围内；省略则保存到草稿目录下的 downloads/' },
        fileName: { type: 'string', description: '保存的文件名；省略则按响应头或 URL 推导' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    validator: downloadFileSchema,
    timeoutMs: subagentToolTimeoutMs,
    source: { type: 'system' },
    buildConfirmation: async (args) => {
      const input = args as z.infer<typeof downloadFileSchema>;
      const host = getDownloadHost(input.url);
      return {
        summary: `将从 ${host || '未知域名'} 下载文件`,
        detail: `链接：${input.url}\n保存目录：${input.destDir?.trim() || '草稿目录/downloads'}\n该域名不在下载白名单内。`,
      };
    },
    execute: async (args, context) => {
      const input = args as z.infer<typeof downloadFileSchema>;
      const allowedHosts = (await loadConfig()).toolSettings?.downloadAllowedHosts;
      return downloadFile(input, allowedHosts, context.signal);
    },
  },
  {
    name: 'create_text_draft',
    description: '在安全草稿目录中创建文本/代码草稿（UTF-8 纯文本）。支持 .txt .md .markdown .json .csv .tsv .html .htm .xml .svg .yaml .yml .toml .ini .conf .log 与 .py .ts .tsx .jsx .java .kt .swift .go .rs .c .h .cpp .hpp .cs .rb .php .pl .lua .r .dart；无后缀时补 .txt。fileName 支持相对子目录（如 icons/game/bot.svg），会自动创建目录，建议按项目或类型归档文件。脚本/可执行后缀（.bat .cmd .ps1 .js .vbs .exe 等）会被拒绝；图片/Excel/Word/PDF 请改用对应专用草稿工具。生成成功后如需向用户展示内容，请调用 preview_text 将文件显示在会话区。',
    risk: 'medium',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        fileName: {
          type: 'string',
          description: '草稿文件名，自动限制为安全文件名；后缀必须在支持列表内，无后缀补 .txt',
        },
        content: {
          type: 'string',
          description: '要写入草稿文件的正文内容',
        },
      },
      required: ['fileName', 'content'],
      additionalProperties: false,
    },
    validator: createTextDraftSchema,
    source: { type: 'system' },
    execute: async (args) => {
      const input = args as z.infer<typeof createTextDraftSchema>;
      return createTextDraft(input.fileName, input.content);
    },
  },
  {
    name: 'create_image_draft',
    description: '在安全草稿目录中创建图片文件。支持 .png .jpg .jpeg .gif .webp .bmp .ico；base64Data 必须是真实图片文件的 base64 编码（写入前做魔数校验，伪造数据会被拒绝）。fileName 支持相对子目录（如 images/logo.png），会自动创建目录。注意 http_request 不返回二进制内容，base64 数据通常需来自 MCP 工具等渠道；无法凭空生成照片级图片。生成成功后如需向用户展示，请调用 preview_image 将图片显示在会话区。',
    risk: 'medium',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        fileName: {
          type: 'string',
          description: '图片草稿文件名（需含图片后缀），自动限制为安全文件名',
        },
        base64Data: {
          type: 'string',
          description: '图片文件的 base64 编码内容，解码后最大 10MB；允许带 data:image/...;base64, 前缀',
        },
      },
      required: ['fileName', 'base64Data'],
      additionalProperties: false,
    },
    validator: createImageDraftSchema,
    source: { type: 'system' },
    execute: async (args) => {
      const input = args as z.infer<typeof createImageDraftSchema>;
      return createImageDraft(input.fileName, input.base64Data);
    },
  },
  {
    name: 'create_docx_draft',
    description: '在安全草稿目录中创建 .docx Word 文档。blocks 为结构化内容块数组：heading（标题，level 1-3）、paragraph（段落）、bullet（项目符号）、table（表格，首行为表头加粗）。表格最多 200 行×30 列，整篇最多 500 个块。fileName 支持相对子目录（如 docs/report.docx），会自动创建目录。生成成功后如需向用户展示，请调用 preview_docx 将文档显示在会话区。',
    risk: 'medium',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        fileName: {
          type: 'string',
          description: 'Word 草稿文件名，自动补全 .docx 扩展名',
        },
        blocks: {
          type: 'array',
          description: '结构化内容块数组，如 [{"type":"heading","text":"标题","level":1},{"type":"paragraph","text":"正文"},{"type":"bullet","text":"要点"},{"type":"table","rows":[["表头1","表头2"],["a","b"]]}]',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'heading | paragraph | bullet | table' },
            },
          },
        },
      },
      required: ['fileName', 'blocks'],
      additionalProperties: false,
    },
    validator: createDocumentDraftSchema,
    source: { type: 'system' },
    execute: async (args) => {
      const input = args as z.infer<typeof createDocumentDraftSchema>;
      return createDocxDraft(input.fileName, input.blocks);
    },
  },
  {
    name: 'create_pdf_draft',
    description: '在安全草稿目录中创建 .pdf 文档，blocks 结构与 create_docx_draft 相同（heading/paragraph/bullet/table）。中文字体按系统探测（Windows 黑体/等线、macOS 苹方），找不到可用中文字体时会明确报错。fileName 支持相对子目录（如 docs/report.pdf），会自动创建目录。',
    risk: 'medium',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        fileName: {
          type: 'string',
          description: 'PDF 草稿文件名，自动补全 .pdf 扩展名',
        },
        blocks: {
          type: 'array',
          description: '结构化内容块数组，结构同 create_docx_draft 的 blocks',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'heading | paragraph | bullet | table' },
            },
          },
        },
      },
      required: ['fileName', 'blocks'],
      additionalProperties: false,
    },
    validator: createDocumentDraftSchema,
    source: { type: 'system' },
    execute: async (args) => {
      const input = args as z.infer<typeof createDocumentDraftSchema>;
      return createPdfDraft(input.fileName, input.blocks);
    },
  },
  {
    name: 'create_excel_draft',
    description: '在安全草稿目录中创建 .xlsx 表格草稿，支持多个工作表。每个工作表的 rows 是二维字符串数组，第一行会被当作表头并加粗；纯数字字符串会写成数值，便于后续在 Excel 中求和。fileName 支持相对子目录（如 data/report.xlsx），会自动创建目录。只能写入草稿目录，无法覆盖用户指定的任意路径文件；如需修改已有 Excel，请先用 read_excel 读出内容，再用本工具生成新文件。',
    risk: 'medium',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        fileName: {
          type: 'string',
          description: '草稿文件名，自动限制为安全文件名并补全 .xlsx 扩展名',
        },
        sheets: {
          type: 'array',
          description: '工作表列表，最多 10 个',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: '工作表名称，最长 31 个字符，不能包含 \\ / * ? : [ ]（非法字符会被替换为下划线）',
              },
              rows: {
                type: 'array',
                description: '表格内容，二维字符串数组；第一行作为表头。最多 2000 行、每行最多 50 列',
                items: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
            required: ['name', 'rows'],
            additionalProperties: false,
          },
        },
      },
      required: ['fileName', 'sheets'],
      additionalProperties: false,
    },
    validator: createExcelDraftSchema,
    source: { type: 'system' },
    execute: async (args) => {
      const input = args as z.infer<typeof createExcelDraftSchema>;
      return createExcelDraft(input.fileName, input.sheets);
    },
  },
  {
    name: 'move_draft_file',
    description: '在安全草稿目录内移动/重命名文件（支持相对子目录，目标目录自动创建）。适用于整理草稿文件：把生成的文件归档到子目录、重命名等。整理前可先用 list_draft_files 查看现有文件。源与目标都必须位于草稿目录内；目标已有同名文件时会被拒绝（不覆盖）。',
    risk: 'medium',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        fileName: {
          type: 'string',
          description: '源文件的相对路径（相对草稿目录，支持子目录）',
        },
        newFileName: {
          type: 'string',
          description: '目标文件的相对路径（相对草稿目录，支持子目录，目录不存在会自动创建）',
        },
      },
      required: ['fileName', 'newFileName'],
      additionalProperties: false,
    },
    validator: moveDraftFileSchema,
    source: { type: 'system' },
    execute: async (args) => {
      const input = args as z.infer<typeof moveDraftFileSchema>;
      return moveDraftFile(input.fileName, input.newFileName);
    },
  },
  {
    name: 'list_draft_files',
    description: '递归列出安全草稿目录（含子目录）中的文件与子目录，返回相对路径、类型与大小。适用于：整理文件前查看草稿目录里有哪些文件、确认移动/重命名结果、用 keyword 在草稿目录内按名称搜索文件。subDirectory 可限定只列出某个子目录。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        subDirectory: {
          type: 'string',
          description: '要列出的相对子目录（如 icons/paint），省略时列出整个草稿目录',
        },
        keyword: {
          type: 'string',
          description: '按相对路径模糊筛选（大小写不敏感的包含匹配），用于在草稿目录内搜索文件',
        },
      },
      additionalProperties: false,
    },
    validator: listDraftFilesSchema,
    source: { type: 'system' },
    execute: async (args) => {
      const input = args as z.infer<typeof listDraftFilesSchema>;
      return listDraftFiles(input.subDirectory, input.keyword);
    },
  },
  {
    name: 'update_excel_cells',
    description: '修改已有 .xlsx 文件的指定单元格。结果一律另存为草稿目录中的新文件，原文件不会被改动。调用前应先用 read_excel 确认工作表名与单元格位置。仅支持 .xlsx；.xlsm 会因宏无法保留而拒绝，CSV 请改用 create_excel_draft 重新生成。',
    risk: 'medium',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '要修改的 .xlsx 文件路径；当当前消息列出了附件绝对路径时，应直接使用该路径',
        },
        sheetName: {
          type: 'string',
          description: '要修改的工作表名称；传空字符串时取第一个工作表',
        },
        updates: {
          type: 'array',
          description: '单元格修改列表，最多 200 条，同一单元格不可重复出现',
          items: {
            type: 'object',
            properties: {
              cell: {
                type: 'string',
                description: '单元格引用，形如 A1、B12、AA100',
              },
              value: {
                type: 'string',
                description: '新的单元格内容；纯数字会写成数值，以 = + - @ 开头的文本会被转义为纯文本',
              },
            },
            required: ['cell', 'value'],
            additionalProperties: false,
          },
        },
        outputFileName: {
          type: 'string',
          description: '另存的文件名，省略时使用「原文件名-updated.xlsx」；支持相对子目录（如 data/report-updated.xlsx），会自动创建目录',
        },
      },
      required: ['filePath', 'sheetName', 'updates'],
      additionalProperties: false,
    },
    validator: updateExcelCellsSchema,
    source: { type: 'system' },
    execute: async (args, context) => {
      const input = args as z.infer<typeof updateExcelCellsSchema>;
      return updateExcelCells(input.filePath, input.sheetName, input.updates, input.outputFileName, context.signal);
    },
  },
  {
    name: 'preview_image',
    description: '把图片文件（.png .jpg .jpeg .gif .webp .bmp .svg）推送到会话区向用户展示，用户无需打开文件即可直接看到。适用于：刚用 create_image_draft 生成图片后、用户要求"展示/预览/看看"某张图片时。文件需在允许访问的目录内，最大 8MB。调用成功即代表用户已看到，不要在回复里重复描述图片内容。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '要预览的图片文件路径；当当前消息或工具结果列出了绝对路径时，应直接使用该路径',
        },
      },
      required: ['filePath'],
      additionalProperties: false,
    },
    validator: previewFilePathSchema,
    source: { type: 'system' },
    execute: async (args, context) => {
      const input = args as z.infer<typeof previewFilePathSchema>;
      return previewImageFile(input.filePath, context);
    },
  },
  {
    name: 'preview_text',
    description: '把文本/代码文件（.txt .md .json .csv .html .xml .yaml 及各类源码后缀）推送到会话区向用户展示，超长内容会截断。适用于：刚用 create_text_draft 生成草稿后、用户要求查看某个文本文件内容时。如需自己分析文件内容，请改用 read_file。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '要预览的文本文件路径；当当前消息或工具结果列出了绝对路径时，应直接使用该路径',
        },
      },
      required: ['filePath'],
      additionalProperties: false,
    },
    validator: previewFilePathSchema,
    source: { type: 'system' },
    execute: async (args, context) => {
      const input = args as z.infer<typeof previewFilePathSchema>;
      return previewTextFile(input.filePath, context);
    },
  },
  {
    name: 'preview_docx',
    description: '把 .docx Word 文档推送到会话区向用户展示（转成 HTML 渲染）。适用于：刚用 create_docx_draft 生成文档后、用户要求查看某个 Word 文档时。旧版 .doc 不支持；如需自己分析文档内容，请改用 extract_word_text。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '要预览的 .docx 文件路径；当当前消息或工具结果列出了绝对路径时，应直接使用该路径',
        },
      },
      required: ['filePath'],
      additionalProperties: false,
    },
    validator: previewFilePathSchema,
    source: { type: 'system' },
    execute: async (args, context) => {
      const input = args as z.infer<typeof previewFilePathSchema>;
      return previewDocxFile(input.filePath, context);
    },
  },


  {
    name: 'http_request',
    description:
      '对任意公开 http/https 地址执行基础 GET 请求。适用于联网查询网页、文本或 JSON 内容。由模型自行决定是否调用、查询哪个地址以及何时查询。仅支持只读请求。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '完整的 http/https 请求地址',
        },
        query: {
          type: 'object',
          description: '可选查询参数，键和值都应为字符串',
          additionalProperties: {
            type: 'string',
          },
        },
        headers: {
          type: 'object',
          description: '可选请求头，键和值都应为字符串；仅用于基础读取场景',
          additionalProperties: {
            type: 'string',
          },
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
    validator: httpRequestSchema,
    source: { type: 'system' },
    execute: async (args, context) => {
      const input = args as z.infer<typeof httpRequestSchema>;
      return httpRequest(input.url, input.query, input.headers, context.signal);
    },
  },
  {
    name: 'install_skill',
    description:
      '从用户指定来源安装一个 Skill：支持 GitHub 仓库/子目录 URL、.zip 包 URL 或 raw SKILL.md URL。'
      + '工具会下载、做完整性校验与安全扫描，并在用户确认后安装；安装完成后不会自动授权给任何智能体，'
      + '需提示用户在「智能体管理」中为相应智能体勾选该 Skill 后方可使用。'
      + '仅在用户明确要求安装某个 skill 时调用；source 必须是用户提供或用户确认过的地址。',
    risk: 'high',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'GitHub 仓库/子目录 URL（如 https://github.com/owner/repo/tree/main/skills/pdf）、.zip 包 URL 或 raw SKILL.md URL',
        },
      },
      required: ['source'],
      additionalProperties: false,
    },
    validator: installSkillSchema,
    timeoutMs: commandToolTimeoutMs,
    source: { type: 'system' },
    buildConfirmation: async (args, context) => {
      const input = args as z.infer<typeof installSkillSchema>;
      const preview = await prepareInstall(input.source, context.signal);
      return { summary: preview.summary, detail: preview.detail, diff: preview.skillMarkdown };
    },
    execute: async (args) => {
      const input = args as z.infer<typeof installSkillSchema>;
      return commitInstall(input.source);
    },
  },
  {
    name: 'run_command',

    description: getCommandToolDescription(),
    risk: 'high',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '要执行的命令字符串',
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
    validator: runCommandSchema,
    timeoutMs: commandToolTimeoutMs,
    source: { type: 'system' },
    buildConfirmation: async (args) => {
      const input = args as z.infer<typeof runCommandSchema>;
      const check = evaluateCommandAutoRun(input.command, (await loadConfig()).toolSettings ?? {});
      return {
        summary: summarizeCommand(input.command),
        detail: [
          `Shell: ${getCommandRuntimeLabel()}`,
          `判定原因: ${check.reason}`,
          check.decision === 'confirm' && check.reason.includes('黑名单') ? '该命令在黑名单中，不能加入白名单。' : '',
        ].filter(Boolean).join('\n'),
      };
    },
    execute: async (args, context) => {
      const input = args as z.infer<typeof runCommandSchema>;
      return runCommand(input.command, context.signal);
    },
  },
  {
    name: 'run_powershell_template',
    description: `执行预定义 PowerShell 模板，仅允许：${availablePowershellTemplates.join('、')}`,
    risk: 'medium',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        templateName: {
          type: 'string',
          enum: availablePowershellTemplates,
          description: '要执行的 PowerShell 模板名称',
        },
      },
      required: ['templateName'],
      additionalProperties: false,
    },
    validator: runPowershellTemplateSchema,
    timeoutMs: commandToolTimeoutMs,
    source: { type: 'system' },
    execute: async (args, context) => {
      const input = args as z.infer<typeof runPowershellTemplateSchema>;
      return runPowershellTemplate(input.templateName, context.signal);
    },
  },
  {
    name: subagentToolName,
    description:
      '派发一个独立的子智能体执行子任务，只返回它的最终结论。子智能体拥有独立上下文，看不到当前对话历史，'
      + '因此 task 必须自包含。适合"中间信息量大但只需要最终结论"的子任务，例如针对某个子问题的资料调研、'
      + '单个来源的核验。子智能体不能再派发子智能体。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: '子任务的完整描述，必须自包含，不要引用当前对话中的上下文',
        },
        role: {
          type: 'string',
          description: '子智能体扮演的角色，例如 researcher、fact_checker',
        },
        label: {
          type: 'string',
          description: '可选的展示标签，用于在界面上标识该子任务',
        },
        allowed_tools: {
          type: 'array',
          description: '可选的工具白名单；省略时子智能体继承当前可用的只读工具',
          items: { type: 'string' },
        },
      },
      required: ['task', 'role'],
      additionalProperties: false,
    },
    validator: runSubagentSchema,
    timeoutMs: subagentToolTimeoutMs,
    source: { type: 'system' },
    execute: async (args, context) => {
      const input = args as z.infer<typeof runSubagentSchema>;
      const depth = context.depth ?? 0;

      if (depth >= maxSubagentDepth) {
        return {
          ok: false,
          content: '',
          error: `已达到子智能体嵌套上限（${maxSubagentDepth}），请直接完成该任务而不要继续派发。`,
        };
      }

      if (!subagentRunner) {
        return { ok: false, content: '', error: '子智能体执行器尚未初始化。' };
      }

      const inheritedToolNames = withoutSubagentTool(await getWorkflowNodeToolNames(context.agentId));
      const requestedToolNames = input.allowed_tools?.length
        ? withoutSubagentTool(input.allowed_tools).filter((name) => inheritedToolNames.includes(name))
        : inheritedToolNames;

      const content = await subagentRunner({
        task: input.task,
        role: input.role,
        label: input.label?.trim() || input.role,
        agentId: context.agentId,
        allowedToolNames: requestedToolNames,
        depth: depth + 1,
        signal: context.signal,
        parentWorkflowMeta: context.workflowMeta,
      });

      return { ok: true, content };
    },
  },
  ...scheduledTaskTools,
];

/**
 * 代码工程只读工具。与通用系统工具分开注册：它们的可访问边界不是全局 allowedPaths，
 * 而是 ToolContext.codeProjectRoot 指向的单个工程根目录，只有 Code 模式才会启用。
 */
const codeTools: ToolDefinition<unknown>[] = [
  {
    name: 'code_list_dir',
    description: '列出当前代码工程内某个目录的子目录与文件。路径必须是工程内相对路径（工程根用 "." 表示）。自动跳过 node_modules、.git 等目录以及 .gitignore 命中的路径。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        dirPath: { type: 'string', description: '工程内相对目录路径，省略或传 "." 表示工程根' },
        recursive: { type: 'boolean', description: '是否递归列出子目录，默认 false' },
        limit: { type: 'number', description: '最多返回多少条目，默认 200，上限 1000' },
      },
      required: [],
      additionalProperties: false,
    },
    validator: codeListDirSchema,
    source: { type: 'system' },
    execute: async (args, context) => {
      const input = args as z.infer<typeof codeListDirSchema>;
      const projectRoot = requireCodeProjectRoot(context);
      return codeListDir(projectRoot, input, context.signal);
    },
  },
  {
    name: 'code_read_file',
    description: '读取当前代码工程内的文本文件，按行返回并带行号。默认读取 200 行，单次上限 500 行；未读完时会给出下一次的 startLine，可分页继续读取。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: '工程内相对文件路径' },
        startLine: { type: 'number', description: '起始行号，从 1 开始，默认 1' },
        maxLines: { type: 'number', description: '本次读取的最大行数，默认 200，上限 500' },
      },
      required: ['filePath'],
      additionalProperties: false,
    },
    validator: codeReadFileSchema,
    source: { type: 'system' },
    execute: async (args, context) => {
      const input = args as z.infer<typeof codeReadFileSchema>;
      const projectRoot = requireCodeProjectRoot(context);
      return codeReadFile(projectRoot, input, context.signal, { conversationId: context.conversationId });
    },
  },
  {
    name: 'code_glob',
    description: '按文件名或路径 glob 模式检索当前代码工程内的文件，例如 "*.ts"、"src/**/*.tsx"。不含 "/" 的模式按文件名匹配，含 "/" 的模式按工程内相对路径匹配。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'glob 模式，支持 **、* 与 ?' },
        dirPath: { type: 'string', description: '限定检索的工程内相对目录，省略表示整个工程' },
        limit: { type: 'number', description: '最多返回多少个文件，默认 100，上限 200' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
    validator: codeGlobSchema,
    source: { type: 'system' },
    execute: async (args, context) => {
      const input = args as z.infer<typeof codeGlobSchema>;
      const projectRoot = requireCodeProjectRoot(context);
      return codeGlob(projectRoot, input, context.signal);
    },
  },
  {
    name: 'code_grep',
    description: '用正则表达式检索当前代码工程内的文件内容，返回命中行及上下文。可用 include / exclude 的 glob 限定文件范围。跳过二进制文件与超过 10MB 的文件。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '正则表达式（JavaScript 语法）' },
        dirPath: { type: 'string', description: '限定检索的工程内相对目录，省略表示整个工程' },
        include: { type: 'array', description: '只检索匹配这些 glob 的文件，如 ["*.ts","*.tsx"]', items: { type: 'string' } },
        exclude: { type: 'array', description: '排除匹配这些 glob 的文件', items: { type: 'string' } },
        contextLines: { type: 'number', description: '每处命中输出的上下文行数，默认 2，上限 10' },
        caseInsensitive: { type: 'boolean', description: '是否忽略大小写，默认 false' },
        maxResults: { type: 'number', description: '最多返回多少处命中，默认 50，上限 100' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
    validator: codeGrepSchema,
    timeoutMs: codeToolTimeoutMs,
    source: { type: 'system' },
    execute: async (args, context) => {
      const input = args as z.infer<typeof codeGrepSchema>;
      const projectRoot = requireCodeProjectRoot(context);
      return codeGrep(projectRoot, input, context.signal);
    },
  },
];

function requireCodeProjectRoot(context: ToolContext): string {
  const projectRoot = context.codeProjectRoot?.trim();
  if (!projectRoot) {
    throw new Error('当前请求没有绑定代码工程，无法使用代码分析工具。');
  }
  return projectRoot;
}

/** 写入类工具需要的完整上下文：沙箱根、工程标识、会话标识（备份与已读追踪都按会话归属）。 */
function requireCodeWriteContext(context: ToolContext): CodeWriteContext {
  const projectRoot = requireCodeProjectRoot(context);

  if (!context.codeProjectWritable) {
    throw new Error('当前代码工程为只读，请先在界面上开启"允许修改"后再试。');
  }

  const conversationId = context.conversationId?.trim();
  if (!conversationId) {
    throw new Error('缺少会话标识，无法安全地记录备份，已阻止本次写入。');
  }

  return {
    projectRoot,
    projectId: context.codeProjectId?.trim() ?? '',
    conversationId,
    signal: context.signal,
  };
}

/**
 * 代码工程写入工具。仅当工程被显式标记为可写时才注册进工具集，
 * 且都实现 buildConfirmation，确保用户在批准前能看到完整 diff。
 */
const codeWriteTools: ToolDefinition<unknown>[] = [
  {
    name: 'code_write_file',
    description: '在当前代码工程内新建文件，或用给定内容整体覆盖已有文件。覆盖已有文件前必须先用 code_read_file 完整读过该文件。局部修改请优先用 code_edit_file，不要用整体覆盖。',
    risk: 'high',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: '工程内相对文件路径，父目录不存在时会自动创建' },
        content: { type: 'string', description: '文件的完整内容' },
      },
      required: ['filePath', 'content'],
      additionalProperties: false,
    },
    validator: codeWriteFileSchema,
    source: { type: 'system' },
    buildConfirmation: async (args, context) => {
      const input = args as z.infer<typeof codeWriteFileSchema>;
      const prepared = await prepareCodeWriteFile(requireCodeWriteContext(context), input);
      return {
        summary: prepared.summary,
        detail: prepared.exists ? `将整体覆盖已有文件：${prepared.relativePath}` : `将新建文件：${prepared.relativePath}`,
        diff: prepared.diff,
      };
    },
    execute: async (args, context) => {
      const input = args as z.infer<typeof codeWriteFileSchema>;
      return codeWriteFile(requireCodeWriteContext(context), input);
    },
  },
  {
    name: 'code_edit_file',
    description: '在当前代码工程内做局部替换：把文件中与 search 完全一致的一段内容替换成 replace。search 必须在文件中唯一出现，且必须照抄 code_read_file 读到的原文（含缩进）。这是修改代码的首选工具。',
    risk: 'high',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: '工程内相对文件路径' },
        search: { type: 'string', description: '要被替换的原文，必须在文件中唯一出现；包含足够上下文以保证唯一' },
        replace: { type: 'string', description: '替换后的新内容；传空串表示删除这段内容' },
      },
      required: ['filePath', 'search', 'replace'],
      additionalProperties: false,
    },
    validator: codeEditFileSchema,
    source: { type: 'system' },
    buildConfirmation: async (args, context) => {
      const input = args as z.infer<typeof codeEditFileSchema>;
      const prepared = await prepareCodeEditFile(requireCodeWriteContext(context), input);
      return {
        summary: prepared.summary,
        detail: `将修改：${prepared.relativePath}（${prepared.matchKind}）`,
        diff: prepared.diff,
      };
    },
    execute: async (args, context) => {
      const input = args as z.infer<typeof codeEditFileSchema>;
      return codeEditFile(requireCodeWriteContext(context), input);
    },
  },
];

const toolMap = new Map<string, ToolDefinition<unknown>>(registeredTools.map((tool) => [tool.name, tool]));

const userSkillDefinitions = new Map<string, UserSkillDefinition>();

export async function loadUserSkills() {
  await userSkillsService.scanAndLoadSkills();

  userSkillDefinitions.clear();
  const skills = userSkillsService.getLoadedSkills();
  for (const skill of skills) {
    userSkillDefinitions.set(skill.metadata.name, skill);
  }
}

function getToolSummary(toolName: string, rawArguments: string) {
  const compact = rawArguments.replace(/\s+/g, ' ').slice(0, 160);
  return `${toolName}(${compact})`;
}

const imageExtensionByMime: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
};

function parseDataUrlMime(dataUrl: string) {
  const match = /^data:([^;,]+)[;,]/.exec(dataUrl);
  return match?.[1] ?? '';
}

/**
 * 把工具结果文本里夹带的 base64 图片提取到 images 字段。
 * 无需提取时原样返回同一引用，调用方可据此避免多余日志。
 */
function normalizeToolResultImages(result: ToolResult): ToolResult {
  if (!result.content || result.content.length < 512) {
    return result;
  }

  const { text, images } = extractBase64ImagesFromText(result.content);
  if (images.length === 0) {
    return result;
  }

  return {
    ...result,
    content: text,
    images: [...(result.images ?? []), ...images],
  };
}

/** 把工具结果里的图片推到会话区预览。与 preview_image 工具共用同一条瞬时通道。 */
function emitToolResultImages(result: ToolResult, context: ToolContext, toolName: string) {
  const images = result.images ?? [];
  const emitFilePreview = context.emitFilePreview;
  if (images.length === 0 || !emitFilePreview) {
    return;
  }

  for (const [index, dataUrl] of images.slice(0, maxToolResultImages).entries()) {
    const extension = imageExtensionByMime[parseDataUrlMime(dataUrl)] ?? '.png';
    emitFilePreview({
      kind: 'image',
      fileName: `${toolName}-${index + 1}${extension}`,
      path: '',
      dataUrl,
    });
  }
}

async function buildErrorMessage(
  toolCall: ToolCall,
  risk: 'low' | 'medium' | 'high',
  summary: string,
  error: string,
): Promise<ChatCompletionApiMessage> {
  await appendToolAuditLog({
    timestamp: new Date().toISOString(),
    toolName: toolCall.function.name,
    risk,
    status: 'error',
    summary,
    detail: error,
  });

  return toToolMessage(
    toolCall,
    {
      ok: false,
      content: '',
      error,
    },
    summary,
  );
}

function toChatCompletionTools(tools: ToolDefinition<unknown>[]): ChatCompletionTool[] {
  return tools.map(toChatCompletionTool);
}

function getAgentSkillNameSet(agentId?: string): Set<string> | null {
  const targetAgentId = agentId?.trim();
  if (!targetAgentId) {
    return null;
  }

  const detail = agentProfilesService.getAgentDetail(targetAgentId);
  if (!detail) {
    return new Set();
  }

  return new Set(detail.skillNames.map((name) => name.trim()).filter(Boolean));
}

async function getUserTools(agentId?: string): Promise<ToolDefinition<unknown>[]> {
  const allowedSkillNames = getAgentSkillNameSet(agentId);

  return Array.from(userSkillDefinitions.values())
    .filter((skill) => allowedSkillNames === null || allowedSkillNames.has(skill.metadata.name))
    .map((skill) => ({
      name: skill.metadata.name,
      description: skill.metadata.description,
      risk: 'low',
      strict: true,
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      } as ToolSchemaShape,
      validator: z.object({}).passthrough(),
      source: {
        type: 'skill',
        skillName: skill.metadata.name,
      },
      execute: async () => ({
        ok: true,
        content: '',
      }),
    }));
}

export async function getRegisteredToolsForAgent(input: { agentId?: string }): Promise<ChatCompletionTool[]> {
  const runtimeTools = await getRuntimeTools(input.agentId);
  return toChatCompletionTools(runtimeTools);
}

/**
 * Code 模式的工具集：只读 code_* 工具 + 用户 skill；
 * 写入工具只有在工程被显式标记为可写时才追加，确保默认不可能改到用户代码；
 * MCP 工具按工程显式绑定的服务追加，不带入通用系统工具。
 */
export async function getCodeProjectTools(writable: boolean, mcpServerNames: string[]): Promise<ChatCompletionTool[]> {
  return toChatCompletionTools(await getCodeRuntimeTools(writable, mcpServerNames));
}

async function getCodeRuntimeTools(writable: boolean, mcpServerNames: string[]): Promise<ToolDefinition<unknown>[]> {
  // 不传 agentId：Code 模式没有绑定 agent，因此开放全部已启用的 skill
  const skillTools = await getUserTools();
  const mcpTools = mcpServerNames.length > 0
    ? await mcpService.getEnabledMcpToolDefinitionsForServerNames(mcpServerNames)
    : [];
  return [...codeTools, ...(writable ? codeWriteTools : []), ...skillTools, ...mcpTools];
}

/**
 * 基础工具名（读写文件、执行命令、访问网络等系统级能力），不含 skill / mcp。
 * 供 workflow 节点保底使用：基础能力全局可用，skill/mcp 由各节点 agent 自行决定。
 */
export function getBaseToolNames(): string[] {
  // 含能力模块工具（如邮件）的全集：这些工具原先就在 registeredTools 里，
  // workflow 节点保底白名单需要继续覆盖它们。能力开关是运行时注入时才生效的。
  return [...registeredTools, ...getAllCapabilityTools()].map((tool) => tool.name);
}

/** 系统工具目录：供智能体编辑器的"允许自动执行"清单展示。 */
export function getSystemToolCatalog() {
  return [...registeredTools, ...getAllCapabilityTools()].map(({ name, description, risk }) => ({ name, description, risk }));
}

/**
 * workflow 节点可用的工具名：基础工具 + 该节点 agent 配置的 skill / mcp。
 */
export async function getWorkflowNodeToolNames(agentId?: string): Promise<string[]> {
  const skillTools = await getUserTools(agentId);
  const mcpTools = await getMcpToolDefinitions(agentId);
  const names = [
    ...getBaseToolNames(),
    ...skillTools.map((tool) => tool.name),
    ...mcpTools.map((tool) => tool.name),
  ];
  return Array.from(new Set(names));
}

/**
 * 定时任务（无人值守）可用的工具名：
 * 剔除 high 风险工具（没人能点确认弹窗）、交互组件（没人填表）、定时任务管理工具本身与派发工具。
 */
export async function getUnattendedToolNames(agentId?: string): Promise<string[]> {
  const runtimeTools = await getRuntimeTools(agentId);
  const excludedNames = new Set<string>([
    ...scheduledTaskToolNames,
    uiFormTool.name,
    renderUiTool.name,
    subagentToolName,
  ]);

  return runtimeTools
    .filter((tool) => !excludedNames.has(tool.name))
    .filter((tool) => resolveUnattendedApproval({ name: tool.name, risk: tool.risk }).approved)
    .map((tool) => tool.name);
}

export async function getRegisteredToolsByNames(toolNames: string[], agentId?: string): Promise<ChatCompletionTool[]> {
  const allowedToolNames = new Set(toolNames.map((name) => name.trim()).filter(Boolean));
  if (allowedToolNames.size === 0) {
    return [];
  }

  const runtimeTools = await getRuntimeTools(agentId);
  return toChatCompletionTools(runtimeTools.filter((tool) => allowedToolNames.has(tool.name)));
}

async function getMcpToolDefinitions(agentId?: string) {
  const targetAgentId = agentId?.trim();
  if (!targetAgentId) {
    return mcpService.getEnabledMcpToolDefinitions();
  }

  const detail = agentProfilesService.getAgentDetail(targetAgentId);
  if (!detail) {
    return [];
  }

  return mcpService.getEnabledMcpToolDefinitionsForServerNames(detail.mcp.enabledServerNames);
}

/**
 * 交互式 UI 工具。刻意不放进 registeredTools：
 * 这样 getBaseToolNames / getSystemToolCatalog / workflow 节点白名单都会自动排除它们，
 * 只有在智能体显式开启对应开关时才注入本次 run 的工具集（第 1 层硬开关）。
 * ui_form（受控表单，默认开）与 render_ui（任意 HTML，默认关）各自独立门控。
 */
const uiTools: ToolDefinition<unknown>[] = [uiFormTool];
const uiHtmlTools: ToolDefinition<unknown>[] = [renderUiTool];

async function getRuntimeTools(agentId?: string, codeProjectId?: string): Promise<ToolDefinition<unknown>[]> {
  // Code 模式是独立的工具边界：只给 code_* 工具、用户 skill 与工程绑定的 mcp，不混入通用系统工具
  const normalizedProjectId = codeProjectId?.trim();
  if (normalizedProjectId) {
    const project = codeProjectsService.getProject(normalizedProjectId);
    return getCodeRuntimeTools(
      project?.writable ?? false,
      project?.mcp.enabledServerNames ?? [],
    );
  }

  const skillTools = await getUserTools(agentId);
  const mcpTools = await getMcpToolDefinitions(agentId);
  // ui_form / render_ui 各自按智能体开关注入；默认智能体（agentId 缺省）按 default 记录判定
  const uiAgentDetail = agentProfilesService.getAgentDetail(agentId?.trim() || DEFAULT_AGENT_ID);
  const uiEnabled = Boolean(uiAgentDetail?.uiDslEnabled);
  const uiHtmlEnabled = Boolean(uiAgentDetail?.uiHtmlEnabled);
  // 长期记忆是全局能力，按 config.memoryEnabled 门控（Code 模式已在上面提前返回，不注入）
  const config = await loadConfig();
  const memoryEnabled = config.memoryEnabled;
  // 内部能力模块（如邮件）贡献的工具，按各自 config 开关门控
  const capabilityTools = getEnabledCapabilityTools(config);
  return [
    ...registeredTools,
    ...capabilityTools,
    ...(memoryEnabled ? memoryTools : []),
    ...(uiEnabled ? uiTools : []),
    ...(uiHtmlEnabled ? uiHtmlTools : []),
    ...skillTools,
    ...mcpTools,
  ];
}

export function getSkillFullContent(skillName: string) {
  return userSkillsService.getSkillFullContent(skillName);
}

export async function executeToolCall(
  toolCall: ToolCall,
  signal: AbortSignal,
  input?: {
    agentId?: string;
    allowedToolNames?: string[];
    requireConfirmation?: boolean;
    /** 无人值守链路（定时任务）传 unattended-safe：low/medium 自动放行，high 直接拒绝。 */
    approvalMode?: ToolApprovalMode;
    depth?: number;
    workflowMeta?: WorkflowMessageMeta;
    codeProjectId?: string;
    conversationId?: string;
    /** 文件预览类工具的会话区推送通道。聊天主链路注入；其余路径缺省为 no-op。 */
    onFilePreview?: (payload: FilePreviewPayload) => void;
    /** 交互组件（ui_form）的会话区推送通道。仅聊天主链路注入。 */
    onUiWidget?: (payload: UiWidgetPayload) => void;
  },
): Promise<ChatCompletionApiMessage> {
  const runtimeTools = await getRuntimeTools(input?.agentId, input?.codeProjectId);
  const allowedToolNames = input?.allowedToolNames ? new Set(input.allowedToolNames) : null;
  const depth = input?.depth ?? 0;
  const filteredTools = runtimeTools.filter((tool) => {
    if (allowedToolNames && !allowedToolNames.has(tool.name)) {
      return false;
    }

    // 深度已达上限时彻底摘掉派发工具，避免子智能体继续套娃
    return !(tool.name === subagentToolName && depth >= maxSubagentDepth);
  });
  const runtimeToolMap = new Map<string, ToolDefinition<unknown>>(filteredTools.map((tool) => [tool.name, tool]));
  const tool = runtimeToolMap.get(toolCall.function.name);

  if (!tool) {
    const summary = getToolSummary(toolCall.function.name, toolCall.function.arguments);
    await appendMainLog('ERROR', `Unknown tool requested: ${toolCall.function.name}`);
    return buildErrorMessage(toolCall, 'high', summary, `未知工具：${toolCall.function.name}`);
  }

  if (tool.source?.type === 'skill') {
    const userSkill = userSkillDefinitions.get(tool.name);
    if (!userSkill) {
      const summary = getToolSummary(toolCall.function.name, toolCall.function.arguments);
      return buildErrorMessage(toolCall, tool.risk, summary, `无法获取 Skill 定义：${tool.name}`);
    }
    return executeUserSkillCall(toolCall, userSkill, signal);
  }

  return executeDefinedToolCall(toolCall, tool, signal, {
    requireConfirmation: input?.requireConfirmation,
    approvalMode: input?.approvalMode,
    agentId: input?.agentId,
    depth,
    workflowMeta: input?.workflowMeta,
    codeProjectRoot: resolveCodeProjectRoot(input?.codeProjectId),
    codeProjectId: input?.codeProjectId,
    codeProjectWritable: input?.codeProjectId ? codeProjectsService.isProjectWritable(input.codeProjectId) : false,
    conversationId: input?.conversationId,
    onFilePreview: input?.onFilePreview,
    onUiWidget: input?.onUiWidget,
  });
}

/** 把工程 id 解析成沙箱根目录。工程已被移除时返回 undefined，工具执行会给出明确错误。 */
function resolveCodeProjectRoot(codeProjectId?: string): string | undefined {
  const normalizedId = codeProjectId?.trim();
  if (!normalizedId) {
    return undefined;
  }

  return codeProjectsService.getProjectRoot(normalizedId) ?? undefined;
}

async function executeDefinedToolCall(
  toolCall: ToolCall,
  tool: ToolDefinition<unknown>,
  signal: AbortSignal,
  options?: {
    requireConfirmation?: boolean;
    approvalMode?: ToolApprovalMode;
    agentId?: string;
    depth?: number;
    workflowMeta?: WorkflowMessageMeta;
    codeProjectRoot?: string;
    codeProjectId?: string;
    codeProjectWritable?: boolean;
    conversationId?: string;
    onFilePreview?: (payload: FilePreviewPayload) => void;
    onUiWidget?: (payload: UiWidgetPayload) => void;
  },
): Promise<ChatCompletionApiMessage> {
  const requireConfirmation = options?.requireConfirmation ?? true;
  const summary = getToolSummary(toolCall.function.name, toolCall.function.arguments);

  // 参数里可能整段夹带源码（如 code_write_file 的 content），日志只留够定位问题的开头部分
  await appendMainLog('INFO', `Tool call requested: ${toolCall.function.name} args=${clipLogText(toolCall.function.arguments || '{}', 500)}`);

  let parsedArguments: unknown;

  try {
    parsedArguments = JSON.parse(toolCall.function.arguments || '{}');
  } catch {
    await appendMainLog('ERROR', `Tool arguments JSON parse failed: ${tool.name}`);
    return buildErrorMessage(toolCall, tool.risk, summary, `工具 ${tool.name} 的参数不是合法 JSON。`);
  }

  const validation = tool.validator.safeParse(parsedArguments);

  if (!validation.success) {
    await appendMainLog('ERROR', `Tool arguments validation failed: ${tool.name}`);
    return buildErrorMessage(
      toolCall,
      tool.risk,
      summary,
      `工具 ${tool.name} 参数校验失败：${validation.error.issues.map((issue: { message: string }) => issue.message).join('；')}`,
    );
  }

  const context: ToolContext = {
    signal,
    requestUserConfirmation: (input) => requestToolConfirmation(input),
    agentId: options?.agentId,
    depth: options?.depth ?? 0,
    workflowMeta: options?.workflowMeta,
    codeProjectRoot: options?.codeProjectRoot,
    codeProjectId: options?.codeProjectId,
    codeProjectWritable: options?.codeProjectWritable,
    conversationId: options?.conversationId,
    emitFilePreview: options?.onFilePreview,
    emitUiWidget: options?.onUiWidget,
  };

  try {
    // 无人值守链路（定时任务）：没有人能点确认弹窗，high 风险工具直接拒绝并把原因回给模型
    if (options?.approvalMode === 'unattended-safe') {
      const decision = resolveUnattendedApproval({ name: tool.name, risk: tool.risk });
      if (!decision.approved) {
        const result: ToolResult = { ok: false, content: '', error: decision.reason ?? `无人值守下不执行工具 ${tool.name}。` };
        await appendMainLog('INFO', `Tool blocked in unattended mode: ${tool.name}`);
        await appendToolAuditLog({
          timestamp: new Date().toISOString(),
          toolName: tool.name,
          risk: tool.risk,
          status: 'cancelled',
          summary,
          detail: result.error ?? 'blocked',
        });

        return toToolMessage(toolCall, result, summary);
      }
    }

    // 全局工具设置：命令白名单与「允许自动执行的工具」清单共用，统一加载一次
    const toolSettings = (await loadConfig()).toolSettings ?? {};

    // run_command 命令白名单旁路：黑名单/危险模式/内置只读清单/用户白名单的判定链（见 command-allowlist.ts）。
    // 仅交互式会话链路生效；unattended 与 workflow 维持原策略。
    let commandAllowlistApproval: CommandAutoRunResult | null = null;
    if (
      tool.name === 'run_command'
      && options?.approvalMode !== 'unattended-safe'
      && !options?.workflowMeta
      && validation.success
    ) {
      const command = (validation.data as z.infer<typeof runCommandSchema>).command;
      commandAllowlistApproval = evaluateCommandAutoRun(command, toolSettings);
      if (commandAllowlistApproval.decision === 'auto') {
        await appendMainLog(`INFO`, `run_command auto-approved by allowlist: ${summarizeCommand(command)} reason=${commandAllowlistApproval.reason}`);
      }
    }

    // download_file 按域名白名单审批：不走全局「自动执行」清单与 unattended 的 medium 放行，
    // 内网地址与（无人值守/工作流下）非白名单域名直接拒绝；交互式会话里非白名单域名弹确认卡
    let downloadApproval: DownloadApproval | null = null;
    if (tool.name === downloadToolName) {
      downloadApproval = resolveDownloadApproval({
        url: (validation.data as z.infer<typeof downloadFileSchema>).url,
        allowedHosts: toolSettings.downloadAllowedHosts,
        unattended: options?.approvalMode === 'unattended-safe',
        workflow: Boolean(options?.workflowMeta),
      });
      if (downloadApproval.decision === 'reject') {
        const result: ToolResult = { ok: false, content: '', error: downloadApproval.reason };
        await appendMainLog('INFO', `download_file blocked: host=${downloadApproval.host || '-'} reason=${downloadApproval.reason}`);
        await appendToolAuditLog({
          timestamp: new Date().toISOString(),
          toolName: tool.name,
          risk: tool.risk,
          status: 'cancelled',
          summary,
          detail: downloadApproval.reason,
        });
        return toToolMessage(toolCall, result, summary);
      }
    }

    const autoApproved = downloadApproval
      ? downloadApproval.decision === 'auto'
      : options?.approvalMode === 'unattended-safe'
      || shouldAutoExecute({ name: tool.name, risk: tool.risk }, toolSettings.autoExecuteTools, Boolean(options?.workflowMeta))
      // 展示型低风险系统工具（ui_form）不弹确认：渲染一个表单还要先点“允许”很荒谬
      || (tool.presentational === true && tool.risk === 'low' && (tool.source?.type ?? 'system') === 'system')
      // 记忆写入/检索（低风险、仅本地文件）自动放行，避免每次记忆都弹确认；能走到这里即说明记忆已启用
      || MEMORY_AUTO_APPROVED_TOOL_NAMES.includes(tool.name)
      || commandAllowlistApproval?.decision === 'auto';
    if (autoApproved) {
      await appendMainLog('INFO', `Tool auto-approved: ${tool.name}${downloadApproval ? ` (download host allowlisted: ${downloadApproval.host})` : ''}`);
    }

    // 中高风险工具在弹窗前先算出实际影响（如 diff），避免用户在看不到改动的情况下批准
    let confirmationPreview: { summary?: string; detail?: string; diff?: string } | null = null;
    if (!autoApproved && requireConfirmation && tool.risk !== 'low' && tool.buildConfirmation) {
      confirmationPreview = await tool.buildConfirmation(validation.data, context);
    }

    // 「总是允许此命令」建议前缀：仅 run_command 且未命中黑名单/危险模式时提供；
    // autoApproved（含白名单自动放行）时无需弹窗，置空避免无谓计算
    const commandAutoAllow = tool.name === 'run_command' && validation.success && !autoApproved
      ? extractCommandPrefix(
        (validation.data as z.infer<typeof runCommandSchema>).command,
        toolSettings,
      )
      : '';

    const outcome = autoApproved
      ? { approved: true, autoRun: false }
      : requireConfirmation
        ? await context.requestUserConfirmation({
          toolName: tool.name,
          risk: tool.risk,
          summary: confirmationPreview?.summary ?? summary,
          detail: confirmationPreview?.detail,
          diff: confirmationPreview?.diff,
          // download_file 只提供「总是允许此域名」，不提供「自动运行并记住」，避免一次勾选绕过域名白名单
          canAutoRun: (tool.source?.type ?? 'system') === 'system' && tool.risk !== 'high' && !downloadApproval,
          commandAutoAllow: commandAutoAllow || undefined,
          domainAutoAllow: downloadApproval?.decision === 'confirm' ? downloadApproval.host : undefined,
        })
        : { approved: true, autoRun: false };

    if (outcome.autoRun) {
      await appendAutoExecuteTool(tool.name);
      await appendMainLog('INFO', `Tool auto-run remembered globally: tool=${tool.name}`);
    }

    const approved = outcome.approved;

    if (!approved) {
      const result: ToolResult = {
        ok: false,
        content: '',
        error: `用户拒绝执行工具 ${tool.name}。`,
      };

      await appendMainLog('INFO', `Tool execution rejected: ${tool.name}`);
      await appendToolAuditLog({
        timestamp: new Date().toISOString(),
        toolName: tool.name,
        risk: tool.risk,
        status: 'cancelled',
        summary,
        detail: result.error ?? 'cancelled',
      });

      return toToolMessage(toolCall, result, summary);
    }

    const timeoutSignal = AbortSignal.timeout(tool.timeoutMs ?? defaultToolTimeoutMs);
    const combinedSignal = AbortSignal.any([signal, timeoutSignal]);
    const executionContext: ToolContext = {
      ...context,
      signal: combinedSignal,
    };

    await appendMainLog('INFO', `Tool execution started: ${tool.name}`);
    const rawResult = await tool.execute(validation.data, executionContext);

    // 工具会把图片夹带在文本里（如 execute_blender_code 返回的 result 里塞渲染图 base64）：
    // 提取为图片内容块并替换成占位说明，否则几十万字符的 base64 会把下一轮请求拖垮
    const normalizedResult = normalizeToolResultImages(rawResult);
    if (normalizedResult !== rawResult) {
      await appendMainLog(
        'INFO',
        `Tool result contained inline base64 images: ${tool.name} extracted=${normalizedResult.images?.length ?? 0}`,
      );
    }
    const result = normalizedResult;

    // 多模态工具结果（如 MCP 截图）推到会话区，用户与模型各自看到一份：
    // 模型经 image_url 内容块，用户经瞬时预览通道，都不占消息历史
    emitToolResultImages(result, context, tool.name);

    await appendMainLog(result.ok ? 'INFO' : 'ERROR', `Tool execution finished: ${tool.name} result=${result.ok ? 'success' : 'error'}`);
    await appendToolAuditLog({
      timestamp: new Date().toISOString(),
      toolName: tool.name,
      risk: tool.risk,
      status: result.ok ? 'success' : 'error',
      summary,
      detail: result.content || result.error || 'ok',
    });

    return toToolMessage(toolCall, result, summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : '工具执行失败。';
    const result: ToolResult = {
      ok: false,
      content: '',
      error: message,
    };

    await appendMainLog('ERROR', `Tool execution failed: ${tool.name} error=${message}`);
    await appendToolAuditLog({
      timestamp: new Date().toISOString(),
      toolName: tool.name,
      risk: tool.risk,
      status: signal.aborted ? 'cancelled' : 'error',
      summary,
      detail: message,
    });

    return toToolMessage(toolCall, result, summary);
  }
}

async function executeUserSkillCall(
  toolCall: ToolCall,
  skill: UserSkillDefinition,
  signal: AbortSignal,
): Promise<ChatCompletionApiMessage> {
  const summary = getToolSummary(toolCall.function.name, toolCall.function.arguments);

  await appendMainLog('INFO', `User skill call requested: ${skill.metadata.name}`);

  try {
    const executeConfig = userSkillsService.parseExecuteConfig(skill.metadata);
    if (executeConfig?.type === 'tool') {
      const result = await executeSkillToolConfig(skill, executeConfig.tool.name, executeConfig.tool.arguments);
      await appendToolAuditLog({
        timestamp: new Date().toISOString(),
        toolName: skill.metadata.name,
        risk: skill.risk,
        status: result.ok ? 'success' : 'error',
        summary,
        detail: result.content || result.error || `Skill tool executed for ${skill.metadata.name}`,
      });
      return toToolMessage(toolCall, result, summary);
    }

    const fullContent = userSkillsService.getSkillFullContent(skill.metadata.name);

    if (!fullContent) {
      return buildErrorMessage(toolCall, skill.risk, summary, `无法获取 Skill 内容: ${skill.metadata.name}`);
    }

    await appendMainLog('INFO', `User skill content loaded: ${skill.metadata.name}`);

    const baseDirNote =
      `[Skill 根目录]: ${skill.directoryPath}\n` +
      `本 Skill 内的相对路径（如 scripts/xxx.py）均相对于上述根目录，` +
      `而非当前工作区目录。执行脚本或读取文件时请使用该根目录拼接的绝对路径。\n\n`;

    const contentWithBaseDir = baseDirNote + fullContent.content;

    const result: ToolResult = {
      ok: true,
      content: contentWithBaseDir,
      data: {
        skillName: skill.metadata.name,
        skillDescription: skill.metadata.description,
        skillContent: contentWithBaseDir,
        skillDirectory: skill.directoryPath,
      },
    };

    await appendToolAuditLog({
      timestamp: new Date().toISOString(),
      toolName: skill.metadata.name,
      risk: skill.risk,
      status: 'success',
      summary,
      detail: `Skill content loaded for ${skill.metadata.name}`,
    });

    return toToolMessage(toolCall, result, summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Skill 执行失败。';
    const result: ToolResult = {
      ok: false,
      content: '',
      error: message,
    };

    await appendMainLog('ERROR', `User skill execution failed: ${skill.metadata.name} error=${message}`);
    await appendToolAuditLog({
      timestamp: new Date().toISOString(),
      toolName: skill.metadata.name,
      risk: signal.aborted ? skill.risk : skill.risk,
      status: signal.aborted ? 'cancelled' : 'error',
      summary,
      detail: message,
    });

    return toToolMessage(toolCall, result, summary);
  }
}

async function executeSkillToolConfig(
  skill: UserSkillDefinition,
  toolName: string,
  rawArguments?: Record<string, unknown>,
): Promise<ToolResult> {
  const normalizedToolName = toolName.trim();
  if (!normalizedToolName) {
    return {
      ok: false,
      content: '',
      error: `Skill ${skill.metadata.name} 的 execute.tool.name 不能为空。`,
    };
  }

  const skillSummary = `Skill ${skill.metadata.name} -> ${normalizedToolName}`;
  const skillTool = toolMap.get(normalizedToolName);
  if (!skillTool || skillTool.source?.type !== 'system') {
    return {
      ok: false,
      content: '',
      error: `Skill ${skill.metadata.name} 配置了不支持的工具：${normalizedToolName}`,
    };
  }

  const validation = skillTool.validator.safeParse(rawArguments ?? {});
  if (!validation.success) {
    return {
      ok: false,
      content: '',
      error: `Skill ${skill.metadata.name} 工具参数校验失败：${validation.error.issues.map((issue: { message: string }) => issue.message).join('；')}`,
    };
  }

  await appendMainLog('INFO', `User skill tool execution started: ${skill.metadata.name} -> ${normalizedToolName}`);
  const result = await skillTool.execute(validation.data, {
    signal: AbortSignal.timeout(skillTool.timeoutMs ?? defaultToolTimeoutMs),
    requestUserConfirmation: () => Promise.resolve({ approved: true }),
    // Skill 直调工具走的是无人值守路径，不允许由此派发子智能体
    depth: maxSubagentDepth,
  });
  await appendMainLog(
    result.ok ? 'INFO' : 'ERROR',
    `User skill tool execution finished: ${skill.metadata.name} -> ${normalizedToolName} result=${result.ok ? 'success' : 'error'}`,
  );
  return result;
}

