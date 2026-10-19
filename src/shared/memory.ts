export type MemoryKind = 'profile' | 'preference' | 'project' | 'fact';

/**
 * 一条长期记忆。Phase 1 刻意保持扁平：全局作用域、无向量、无版本链、无关系图。
 * content 是一句话、自包含的持久事实；pinned 每轮必注入且不参与淘汰（借鉴 supermemory isStatic）。
 */
export type MemoryEntry = {
  id: string;
  kind: MemoryKind;
  content: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  /** 最近一次被检索注入的时间，参与排序；从未用过为 null。 */
  lastUsedAt: string | null;
  useCount: number;
  /** 来源会话，便于回溯（supermemory provenance 的极简版）。 */
  sourceConversationId: string | null;
};

export type MemoryAddInput = {
  kind?: MemoryKind;
  content: string;
  pinned?: boolean;
  sourceConversationId?: string | null;
};

export type MemoryOperationResult = {
  ok: boolean;
  error?: string;
  data?: MemoryEntry;
};

/** 记忆操作审计条目（写入独立的 memory-audit.log）。 */
export type MemoryAuditOp = 'add' | 'forget' | 'dedup_skip' | 'extract';
export type MemoryAuditSource = 'tool' | 'auto' | 'model';

export type MemoryAuditEntry = {
  op: MemoryAuditOp;
  /** tool=模型显式调用工具；auto=自动抽取；model 预留。 */
  source: MemoryAuditSource;
  id?: string;
  kind?: MemoryKind;
  /** forget 必须带上被删内容以便手工找回；extract 可带命中条目内容。 */
  content?: string;
  /** 补充说明，如 dedup 命中、extract 命中条数。 */
  reason?: string;
};
