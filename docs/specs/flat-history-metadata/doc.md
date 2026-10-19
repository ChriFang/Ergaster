# 左侧边栏输入记录扁平化与元信息展示

## 需求场景与处理逻辑

用户要求参考 `E:\other-code\agent-ui` 项目，修改当前项目主界面左侧边栏的输入列表样式：

- 输入记录不再按智能体分组展示。
- 每条输入记录需要展示关联智能体名称。
- 每条输入记录需要展示时间。
- 样式参考 `agent-ui` 中 `components/sidebar.tsx` 的输入记录列表：内容在上方，元信息行展示 `智能体 · 时间`。

当前项目 `desktop-tools` 的输入记录位于主界面左侧边栏的“输入记录”页签中，当前逻辑会先按 `agentId` 聚合，然后渲染智能体分组标题和该分组下的输入项。此次修改将改为直接按 `inputHistory` 原顺序渲染扁平列表。

## 架构与技术方案

### 1. 数据模型补充时间字段

当前 `InputHistoryEntry` 只有：

```ts
export type InputHistoryEntry = {
  text: string;
  agentId: string | null;
};
```

为了展示时间，需要新增：

```ts
createdAt: number;
```

该字段使用毫秒级 Unix 时间戳，便于渲染“刚刚 / N 分钟前 / N 小时前 / N 天前”。

### 2. 历史记录持久化兼容

当前历史文件可能存在两种旧格式：

- legacy：字符串数组，如 `["hello"]`。
- v2：对象数组，如 `{ text, agentId }`。

新增时间字段后需要兼容：

- legacy 字符串项转换为 `{ text, agentId: null, createdAt: Date.now() }`。
- 旧对象项缺少 `createdAt` 时补为 `Date.now()`。
- 新增保存时写入当前时间。

### 3. 侧边栏渲染改为扁平列表

删除 `SidebarPanel.tsx` 中的：

- `useMemo` 引用。
- `HistoryGroup` 类型。
- `groupHistoryByAgent` 函数。
- 分组头部和分组容器渲染。

新增辅助函数：

```ts
function getHistoryAgentMeta(entry: InputHistoryEntry, agents: AgentProfileListItem[]) {
  if (entry.agentId === null) {
    return { title: '默认模式', avatarColor: 'default' };
  }
  const agent = agents.find((item) => item.id === entry.agentId);
  return {
    title: agent?.title ?? '未知智能体',
    avatarColor: agent?.avatarColor ?? 'blue',
  };
}

function formatHistoryTime(timestamp: number) {
  const diff = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}
```

渲染结构参考 `agent-ui`：

```tsx
<div className="app-history-list">
  {inputHistory.map((entry, index) => {
    const agentMeta = getHistoryAgentMeta(entry, agents);
    return (
      <button className="app-history-item">
        <span className="app-history-item-text">{entry.text}</span>
        <span className="app-history-item-meta">
          <span>{agentMeta.title}</span>
          <span>·</span>
          <span>{formatHistoryTime(entry.createdAt)}</span>
        </span>
      </button>
    );
  })}
</div>
```

保留现有点击行为：点击输入记录时调用 `onSelectHistory(entry)`，继续恢复文本和智能体。

### 4. 样式调整

当前 `.app-history-item` 是单行省略文本。修改为卡片式两行：

- 第一行：输入内容，最多两行，超出截断。
- 第二行：元信息，等宽小字号，展示智能体和时间。
- 保留 hover 和 active 样式。
- 删除或停用 `.app-history-group*` 相关样式。

## 受影响文件

### `e:\other-code\desktop-tools\src\shared\contracts.ts`

修改类型：类型定义变更。

影响位置：

- `InputHistoryEntry`。

预期修改：

```ts
export type InputHistoryEntry = {
  text: string;
  agentId: string | null;
  createdAt: number;
};
```

### `e:\other-code\desktop-tools\src\main\input-history-service.ts`

修改类型：历史记录读写与迁移逻辑。

影响函数：

- `normalizeHistoryLegacy`
- `normalizeHistoryV2`
- `appendInputHistory`

预期处理：

- 读取旧字符串格式时补 `createdAt`。
- 读取缺少 `createdAt` 的对象格式时补 `createdAt`。
- 新增记录时写入 `Date.now()`。
- 去重仍按 `text + agentId` 保持现有行为，重复提交会成为最新记录并更新时间。

### `e:\other-code\desktop-tools\src\renderer\features\layout\SidebarPanel.tsx`

修改类型：UI 渲染逻辑变更。

影响函数/结构：

- 删除 `useMemo` 引用。
- 删除 `HistoryGroup` 类型。
- 删除 `groupHistoryByAgent`。
- 新增 `getHistoryAgentMeta`。
- 新增 `formatHistoryTime`。
- 修改“输入记录”页签中 `.app-history-list` 的渲染结构。

预期处理：

- 不再按智能体归类。
- 逐条展示 `inputHistory`。
- 每条记录展示文本、智能体名称、相对时间。
- 默认模式显示 `默认模式`。
- 智能体被删除或找不到时显示 `未知智能体`。

### `e:\other-code\desktop-tools\src\renderer\styles.css`

修改类型：CSS 样式调整。

影响选择器：

- `.app-history-item`
- 新增 `.app-history-item-text`
- 新增 `.app-history-item-meta`
- 移除或不再使用 `.app-history-group*` 相关样式

预期样式：

```css
.app-history-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  line-height: 1.45;
}

.app-history-item-text {
  display: -webkit-box;
  overflow: hidden;
  font-size: 12px;
  line-clamp: 2;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.app-history-item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
}
```

## 数据流路径

1. 用户在输入框提交内容。
2. 渲染进程调用 `appendInputHistory({ text, agentId, createdAt })` 或由主进程补齐时间。
3. 主进程 `appendInputHistory` 规范化输入，写入历史文件。
4. 返回最新 `InputHistoryEntry[]` 给渲染进程。
5. `App.tsx` 更新 `inputHistory` 状态。
6. `SidebarPanel.tsx` 在“输入记录”页签扁平渲染每条记录。
7. UI 通过 `entry.agentId` 从 `agents` 查找智能体名称，通过 `entry.createdAt` 格式化相对时间。

## 边界条件与异常处理

- 空历史：继续展示 `暂无输入记录`。
- 默认模式：`agentId === null` 时显示 `默认模式`。
- 智能体不存在：显示 `未知智能体`。
- 旧历史文件：自动迁移并补齐时间字段。
- 非法历史文件或读取失败：维持现有行为，记录日志并返回空数组。
- 重复输入：保留现有去重逻辑，重复项移到顶部并刷新 `createdAt`。
- 系统时间异常：格式化函数使用 `Math.max(0, Date.now() - timestamp)` 避免出现负数。

## 预期结果

- 左侧边栏“输入记录”页签展示为扁平列表。
- 不再出现按智能体分组的标题和分组间隔。
- 每条记录展示：输入内容、智能体名称、相对时间。
- 历史记录点击恢复输入草稿的行为不变。
- 旧历史数据可继续读取，不导致界面崩溃。
- TypeScript 类型检查通过。
