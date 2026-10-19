export type ContextMenuState = {
  x: number;
  y: number;
  type: 'message-selection' | 'conversation-blank';
  selectedText?: string;
};

/**
 * 设置弹窗的导航标识。静态页签各占一枚；扩展能力子项用 `extension:<id>` 复合值，
 * 这样单一 tab 字段即可同时表达"选中某静态页"或"选中某个已添加扩展"，不引第二份状态。
 */
export type SettingsDialogTab =
  | 'agents'
  | 'skills'
  | 'mcp'
  | 'workflow'
  | 'general'
  | 'tools'
  | 'about'
  | 'extensions'
  | `extension:${string}`;

/** 从 `extension:<id>` 复合值取出扩展 id；非扩展页签返回 null。 */
export function parseExtensionTab(tab: SettingsDialogTab): string | null {
  return tab.startsWith('extension:') ? tab.slice('extension:'.length) : null;
}

export type SettingsDialogState = {
  open: boolean;
  tab: SettingsDialogTab;
  create?: boolean;
  agentId?: string;
};
