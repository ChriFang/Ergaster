import type { McpAgentBinding } from './mcp';

/** 已导入的代码工程。工程本体在用户磁盘上，应用只保存指向它的索引。 */
export type CodeProjectListItem = {
  id: string;
  name: string;
  rootPath: string;
  /** 是否允许智能体修改该工程的文件。默认 false，只读。 */
  writable: boolean;
  /** 该工程允许使用的 MCP 服务。默认为空，即不接入任何 MCP 工具。 */
  mcp: McpAgentBinding;
  createdAt: string;
  updatedAt: string;
};

export type CodeProjectMetadata = CodeProjectListItem;

export type CodeProjectOperationResult = {
  ok: boolean;
  error?: string;
  /** 非阻断性提示，例如工程文件数过多。 */
  warning?: string;
  data?: CodeProjectListItem;
};

export type ImportCodeProjectResult = CodeProjectOperationResult & {
  /** 用户在系统目录选择框里点了取消。 */
  cancelled?: boolean;
};

/** 会话归组前缀：代码工程会话复用 conversation.agentId 字段，取值形如 code:{projectId}。 */
export const codeConversationScopePrefix = 'code:';

export function buildCodeConversationScope(projectId: string) {
  return `${codeConversationScopePrefix}${projectId}`;
}
