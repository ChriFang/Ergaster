# 输入记录文件持久化设计方案

## 功能概述
为当前桌面应用增加“用户输入记录”文件持久化能力。要求如下：
- 用户每次发送的输入记录需要落盘保存。
- 程序初始化时自动读取本地记录，并展示在左侧栏“输入记录”区域。
- 最多保留 100 条记录，超出后丢弃更早记录。
- 保存路径固定为：`C:\Users\用户目录\AppData\Roaming\desktop-tools\chat-history`

## 当前现状分析

### 前端现状
- 输入记录状态保存在 `e:\other-code\desktop-tools\src\renderer\App.tsx:42` 的 `inputHistory` 中，当前仅存在于内存。
- 用户发送消息时，在 `e:\other-code\desktop-tools\src\renderer\App.tsx:255` 的 `handleRunAgent` 中执行：
  - `setInputHistory((prev) => { const next = [prompt, ...prev]; return next.slice(0, 100); })`
- 左侧栏展示逻辑位于 `e:\other-code\desktop-tools\src\renderer\App.tsx:368`，通过 `inputHistory.map(...)` 渲染。
- 当前应用启动时并不会从本地文件加载输入记录。

### 主进程现状
- 现有配置持久化模式在 `e:\other-code\desktop-tools\src\main\config-service.ts:1`，特点是：
  - 主进程负责文件读写
  - 启动时按需创建目录
  - renderer 通过 IPC 调用主进程能力
- 现有主进程入口在 `e:\other-code\desktop-tools\src\main\index.ts:59` 附近注册 IPC。
- preload 桥接定义在 `e:\other-code\desktop-tools\src\preload\index.ts:13`。
- 前端 API 类型定义在 `e:\other-code\desktop-tools\src\shared\contracts.ts:26`。

## 需求拆解与处理逻辑

### 场景一：程序启动时加载历史输入记录
**目标**
- 应用初始化时从本地文件读取已保存输入记录。
- 成功读取后展示在左侧栏。
- 文件不存在时按空列表处理。

**处理逻辑**
1. renderer 启动时调用 `window.desktopApp.getInputHistory()`。
2. preload 转发到主进程 IPC。
3. 主进程服务读取 `chat-history` 文件。
4. 若文件不存在，返回空数组。
5. renderer 将返回值写入 `inputHistory` state。

**预期结果**
- 程序重启后，左侧栏仍能看到之前的输入记录。

### 场景二：发送消息时追加记录并持久化
**目标**
- 每次用户发送消息后，将当前 prompt 写入历史文件。
- 最多保留 100 条。

**处理逻辑**
1. 用户提交 prompt 后，前端仍立即更新本地 `inputHistory`，保持 UI 即时反馈。
2. 同时调用 `window.desktopApp.appendInputHistory(prompt)`。
3. 主进程服务读取现有历史、把新记录插入头部、截断到 100 条后覆盖写回文件。
4. 若连续发送相同输入，首版不做去重，按真实发送记录保存。

**预期结果**
- 历史输入在 UI 与文件中一致。
- 历史上限始终不超过 100 条。

### 场景三：点击左侧记录回填输入框
**目标**
- 保持当前交互：点击历史记录，可将文本回填到输入框。

**处理逻辑**
- 继续复用 `e:\other-code\desktop-tools\src\renderer\App.tsx:317` 的 `handleHistoryClick`。
- 不改变已有交互，仅改变数据来源从“纯内存”升级为“初始化加载 + 运行时持久化”。

## 架构与技术方案

### 本地存储路径
按你的要求，保存路径使用：
- 目录：`C:\Users\用户目录\AppData\Roaming\desktop-tools`
- 文件：`C:\Users\用户目录\AppData\Roaming\desktop-tools\chat-history`

实现上建议使用 Electron：
```ts
const historyDirectory = path.join(app.getPath('appData'), 'desktop-tools');
const historyPath = path.join(historyDirectory, 'chat-history');
```

这样在 Windows 下实际路径即：
`C:\Users\<当前用户>\AppData\Roaming\desktop-tools\chat-history`

### 存储格式建议
建议采用 JSON 数组，文件内容示例：

```json
[
  "打开记事本",
  "帮我整理今天的待办",
  "搜索桌面中的 pdf 文件"
]
```

原因：
- 实现简单
- 读取与截断方便
- 与当前 `inputHistory: string[]` 数据结构完全一致

### 主进程服务建议
建议新增 `src/main/input-history-service.ts`，职责：
- 获取历史文件路径
- 确保目录存在
- 读取历史记录
- 追加一条历史记录
- 覆盖保存完整历史记录
- 保证最多保留 100 条

接口建议：

```ts
export async function getInputHistory(): Promise<string[]>;
export async function appendInputHistory(entry: string): Promise<string[]>;
export function getInputHistoryPath(): string;
```

### IPC 设计建议
建议新增 IPC：
- `history:get-inputs`
- `history:append-input`

对应扩展：
- `src/shared/contracts.ts`
- `src/preload/index.ts`
- `src/main/index.ts`

### 前端改造建议
修改 `src/renderer/App.tsx`：
1. 初始化时调用 `getInputHistory()` 并写入 `setInputHistory`。
2. 发送消息时：
   - 先本地 `setInputHistory`，保持即时反馈
   - 再异步调用 `appendInputHistory(prompt)`
   - 以主进程返回结果覆盖前端 `inputHistory`，确保与文件一致
3. 若保存失败：
   - 不阻断正常对话发送
   - 保留当前 UI 记录
   - 仅记录 `runStatus` 或静默失败，首版建议静默失败，避免干扰聊天主流程

## 受影响文件清单

### 必改文件
1. `e:\other-code\desktop-tools\src\renderer\App.tsx`
   - 初始化加载输入记录
   - 发送后持久化输入记录
2. `e:\other-code\desktop-tools\src\shared\contracts.ts`
   - 新增输入记录相关 API 类型
3. `e:\other-code\desktop-tools\src\preload\index.ts`
   - 暴露输入记录 IPC API
4. `e:\other-code\desktop-tools\src\main\index.ts`
   - 注册输入记录相关 IPC handlers

### 建议新增文件
1. `e:\other-code\desktop-tools\src\main\input-history-service.ts`
   - 输入记录文件读写服务

## 数据流路径

### 启动加载
1. `App.tsx` 初始化
2. 调用 `window.desktopApp.getInputHistory()`
3. preload 转发 IPC
4. 主进程 `input-history-service.ts` 读取 `chat-history`
5. 返回 `string[]`
6. 前端更新左侧栏展示

### 发送保存
1. 用户提交 prompt
2. 前端更新本地 `inputHistory`
3. 前端调用 `window.desktopApp.appendInputHistory(prompt)`
4. 主进程读取旧文件、插入新记录、截断为 100 条
5. 主进程覆盖写回 `chat-history`
6. 返回最新历史列表
7. 前端用返回值校正本地状态

## 边界条件与异常处理
- 历史文件不存在：返回空列表，并在首次写入时自动创建。
- 历史目录不存在：自动创建 `AppData\Roaming\desktop-tools`。
- 输入为空：不写入文件，沿用现有发送前校验。
- 历史文件损坏或 JSON 非法：
  - 建议记录日志
  - 回退为空列表
  - 不阻断程序启动
- 超过 100 条：仅保留最新 100 条。
- 单条历史中包含换行：直接按字符串保存，允许恢复原始文本。
- 持久化失败：不影响正常发送给模型。

## 实现细节建议

### 主进程服务核心逻辑示例
```ts
const HISTORY_LIMIT = 100;
const historyDirectory = path.join(app.getPath('appData'), 'desktop-tools');
const historyPath = path.join(historyDirectory, 'chat-history');

export async function getInputHistory(): Promise<string[]> {
  await fs.mkdir(historyDirectory, { recursive: true });

  try {
    const raw = await fs.readFile(historyPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string').slice(0, HISTORY_LIMIT) : [];
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return [];
    }
    return [];
  }
}

export async function appendInputHistory(entry: string): Promise<string[]> {
  const normalized = entry.trim();
  if (!normalized) {
    return getInputHistory();
  }

  const current = await getInputHistory();
  const next = [normalized, ...current].slice(0, HISTORY_LIMIT);
  await fs.writeFile(historyPath, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
```

### 前端调用示例
```ts
useEffect(() => {
  void window.desktopApp.getInputHistory().then(setInputHistory).catch(() => {});
}, []);

const prompt = input.trim();
setInputHistory((prev) => [prompt, ...prev].slice(0, 100));
void window.desktopApp.appendInputHistory(prompt).then(setInputHistory).catch(() => {});
```

## 预期结果
完成后应满足：
- 输入记录会保存到 `C:\Users\用户目录\AppData\Roaming\desktop-tools\chat-history`
- 程序启动时自动读取并显示在左侧栏
- 最多只保留 100 条
- 点击历史项仍可回填输入框
- 保存失败不会影响主对话流程

## 待确认点
当前方案默认使用 **JSON 数组文件格式** 保存 `chat-history`。如果你没有特殊要求，我建议直接采用该方式，因为与现有前端状态结构一致、实现最简单、可维护性最好。