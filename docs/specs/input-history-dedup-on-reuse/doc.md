# 输入记录复用去重修复方案

## 功能概述
修复一个输入记录重复保存问题：
- 用户从左侧栏“输入记录”点击一条历史记录后，若不修改内容直接发送，当前实现会再次把这条相同内容保存到历史顶部，导致列表中出现两条相同记录。
- 期望行为：
  - **如果用户只是选择历史记录并直接发送，则只保留一条该记录**。
  - **如果用户选择历史记录后又编辑了内容，再发送时应视为新输入，允许新增一条记录**。

## 当前现状分析

### 前端交互现状
- 历史记录点击回填输入框逻辑在 `e:\other-code\desktop-tools\src\renderer\App.tsx:319` 的 `handleHistoryClick(text)`，当前仅执行：
  ```ts
  setInput(text);
  ```
- 发送逻辑在 `e:\other-code\desktop-tools\src\renderer\App.tsx:256` 的 `handleRunAgent`。
- 当前发送时会立即执行：
  ```ts
  setInputHistory((prev) => {
    const next = [prompt, ...prev];
    return next.slice(0, 100);
  });
  ```
  这一步没有区分“新输入”和“从历史回填后未修改直接发送”。
- 随后又调用：
  ```ts
  window.desktopApp.appendInputHistory(prompt)
  ```
  把内容持久化到文件。

### 主进程持久化现状
- 输入记录文件服务在 `e:\other-code\desktop-tools\src\main\input-history-service.ts:43` 的 `appendInputHistory(entry)`。
- 当前逻辑是简单头插：
  ```ts
  const current = await getInputHistory();
  const next = [normalizedEntry, ...current].slice(0, HISTORY_LIMIT);
  ```
- 这意味着只要传入了与已有历史相同的文本，就一定会重复插入一条。

## 问题根因
问题不只在前端，也不只在主进程：
1. **前端不知道当前输入是否来自历史回填且未修改**，所以会先乐观插入一条重复记录。
2. **主进程持久化层没有做去重搬移**，即使前端传入重复内容，也会再次写入文件。

因此，最稳妥的方案应当是：
- **前端增加“历史回填来源追踪”**，避免 UI 先显示出重复项。
- **主进程增加“同内容去重搬移”逻辑**，保证最终文件数据不重复，作为最终一致性兜底。

## 需求拆解与处理逻辑

### 场景一：用户点击历史记录后直接发送
**目标**
- 若用户点击一条历史记录，且没有修改内容，直接发送时，历史中只保留一条该记录。

**处理逻辑**
1. 点击历史记录时，除了 `setInput(text)`，额外记录一个“本次输入来自历史回填”的标记，例如：
   - `selectedHistoryDraft: string | null`
2. 发送时比较：
   - 若 `prompt === selectedHistoryDraft`，说明用户未改动。
3. 此时前端更新 `inputHistory` 时，不新增副本，而是把该项移动到顶部：
   ```ts
   const next = [prompt, ...prev.filter((item) => item !== prompt)].slice(0, 100);
   ```
4. 主进程写文件时也执行相同策略，确保最终文件内只有一条。

**预期结果**
- 直接复用历史输入发送后，不会新增第二条相同记录。
- 如果原本该项不在顶部，则会被移动到顶部，符合“最近使用”的语义。

### 场景二：用户点击历史记录后进行了编辑再发送
**目标**
- 如果用户选择历史记录后又修改了文本，发送时应按新输入处理。

**处理逻辑**
1. 点击历史记录时记录原始文本 `selectedHistoryDraft`。
2. 用户在输入框变更内容时：
   - 若当前输入值与 `selectedHistoryDraft` 不一致，则视为已编辑。
3. 发送时：
   - 若 `prompt !== selectedHistoryDraft`，按普通新输入处理。
4. 这时前端与主进程都按新内容写入历史。

**预期结果**
- 修改后的内容可作为一条新记录保存。
- 原始历史项保留不变。

### 场景三：用户手动输入与已有历史重复内容
**目标**
- 如果用户不是通过点击历史记录，而是手动输入了与历史相同的内容，建议仍然只保留一条并移动到顶部。

**处理逻辑**
- 主进程 `appendInputHistory()` 统一做全局去重搬移：
  ```ts
  const next = [normalizedEntry, ...current.filter((item) => item !== normalizedEntry)].slice(0, HISTORY_LIMIT);
  ```
- 前端本地更新也建议采用同样逻辑。

**预期结果**
- 历史记录整体保持唯一集合 + 最近使用排序，不会因为同文案再次发送而无限重复。

## 架构与技术方案

### 前端状态设计
建议在 `App.tsx` 新增一个本地状态：

```ts
const [selectedHistoryDraft, setSelectedHistoryDraft] = useState<string | null>(null);
```

用途：
- 标记当前输入框内容是否来源于左侧历史点击。
- 判断用户是否对该内容做过编辑。

### 前端行为建议
#### 点击历史记录时
```ts
function handleHistoryClick(text: string) {
  setInput(text);
  setSelectedHistoryDraft(text);
}
```

#### 输入框内容变化时
当前 `Composer` 是受控组件，`App.tsx` 通过 `onChange={setInput}` 传入。建议改为包装函数：

```ts
function handleInputChange(value: string) {
  setInput(value);
  if (selectedHistoryDraft !== null && value !== selectedHistoryDraft) {
    setSelectedHistoryDraft(null);
  }
}
```

这样一旦用户开始修改，就取消“未改动复用历史”的标记。

#### 发送时更新历史
建议统一使用“去重后置顶”逻辑：

```ts
setInputHistory((prev) => [prompt, ...prev.filter((item) => item !== prompt)].slice(0, 100));
setSelectedHistoryDraft(null);
```

这样：
- 直接复用历史发送：不会重复
- 新输入但恰好与旧历史相同：也不会重复
- 修改后新内容：会新增新条目

### 主进程持久化建议
修改 `e:\other-code\desktop-tools\src\main\input-history-service.ts:43` 的 `appendInputHistory(entry)`：

从：
```ts
const next = [normalizedEntry, ...current].slice(0, HISTORY_LIMIT);
```

改为：
```ts
const next = [normalizedEntry, ...current.filter((item) => item !== normalizedEntry)].slice(0, HISTORY_LIMIT);
```

这一步是后端兜底，确保无论前端怎么调用，文件数据都不会出现重复文本。

## 受影响文件清单

### 必改文件
1. `e:\other-code\desktop-tools\src\renderer\App.tsx`
   - 增加历史回填追踪状态
   - 包装输入框变更逻辑
   - 修改发送时本地历史更新策略为“去重后置顶”
2. `e:\other-code\desktop-tools\src\main\input-history-service.ts`
   - 修改追加历史逻辑为“去重后置顶”

### 可能涉及但不一定需要修改的文件
1. `e:\other-code\desktop-tools\src\renderer\features\composer\Composer.tsx`
   - 当前无需修改，只要保持受控输入即可

## 数据流路径

### 历史点击后直接发送
1. 用户点击侧边栏记录
2. `handleHistoryClick(text)` 设置：
   - `input = text`
   - `selectedHistoryDraft = text`
3. 用户直接发送
4. `handleRunAgent()` 计算 `prompt`
5. 前端本地历史更新为“去重后置顶”
6. 主进程 `appendInputHistory()` 再次以“去重后置顶”写文件
7. 最终 UI 与文件都只保留一条

### 历史点击后编辑再发送
1. 用户点击侧边栏记录
2. `selectedHistoryDraft = 原文`
3. 用户修改输入框
4. `handleInputChange(value)` 发现 `value !== selectedHistoryDraft`，清空该标记
5. 发送时按新输入处理
6. 若新内容未存在，则新增一条新记录

## 边界条件与异常处理
- 用户点击历史记录后删除部分内容再发送：视为新输入。
- 用户点击历史记录后改了内容又改回原文：
  - 若最终发送内容与原始回填文本一致，仍可按“同内容去重后置顶”处理，不会重复。
- 历史中如果由于旧版本已经存在多条相同文本：
  - 新版发送一次相同文本后，主进程会自动收敛为一条。
- 历史文件中存在前后空格差异：
  - 当前服务已 `trim()`，因此 `