// Skills 列表项（简化）
export type SkillListItem = {
  name: string;
  description: string;
  directoryName: string;
  directoryPath: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateSkillRequest = {
  name: string;
  description: string;
  content: string;
};

export type UpdateSkillRequest = {
  directoryName: string;
  name: string;
  description: string;
  content: string;
};

export type SkillOperationResult = {
  ok: boolean;
  error?: string;
  data?: unknown;
};

export type SkillFullContent = {
  name: string;
  description: string;
  content: string;
  directoryName: string;
};

/** 主进程推送到 renderer 的 Skills 集合变更事件（新增/更新/删除/安装后触发列表刷新）。 */
export type SkillsChangedEvent = {
  reason: 'created' | 'updated' | 'deleted' | 'installed';
  /** 相关 Skill 名称（若适用）。 */
  name?: string;
};
