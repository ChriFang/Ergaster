# 修复通用设置多行路径输入 Enter 无法换行

## 需求场景与问题现象
通用设置界面中，“允许打开的路径”和“搜索目录”是多行路径配置项，界面提示为“每行一个目录”。当前用户在这些输入框中按 Enter 时无法保留新行，表现为无法换行或末尾换行立即消失。

经定位，这两个控件位于 `SettingsPanel`，实际是 `textarea`，没有发现针对 Enter 的 `onKeyDown` 阻止逻辑。问题原因是受控值在输入过程中被立即规范化：

1. `SettingsPanel` 的 `textarea` 触发 `onAllowedPathsChange` / `onSearchRootsChange`。
2. `App` 中立即调用 `splitMultilineInput(value)`。
3. `splitMultilineInput` 会按换行拆分、`trim()` 每行并 `filter(Boolean)` 删除空行。
4. `useSettingsState` 再把数组 `join('\n')` 回显给 `textarea`。

因此用户在末尾按 Enter 后，原始输入短暂变为 `C:\foo\n`，但会立刻被转成数组 `["C:\\foo"]` 并回显为 `C:\foo`，导致换行被吞掉。

## 架构与技术方案
采用“编辑态字符串”和“保存态数组”分离的方案：

1. 在设置状态 hook 中新增本地编辑态：
   - `allowedPathsText`
   - `searchRootsText`
2. 打开或加载配置时，将已保存数组转换成多行文本写入编辑态。
3. textarea 输入时只更新对应编辑态字符串，不再立即调用 `splitMultilineInput`。
4. 保存配置时，再把编辑态字符串通过 `splitMultilineInput` 转成数组写入 `payload.toolSettings.allowedPaths` / `payload.toolSettings.searchRoots`。
5. 保存成功并收到规范化后的配置后，同步刷新编辑态字符串，保证界面与落盘配置一致。

该方案保留现有配置结构不变：主进程和工具使用的仍是 `string[]`，仅调整前端表单编辑过程。

## 影响文件
- 修改 `e:\other-code\desktop-tools\src\renderer\lib\hooks\use-settings-state.ts`
  - 类型：状态管理调整
  - 影响函数：`useSettingsState`、`saveConfigWithValues`
  - 新增职责：维护多行 textarea 的原始编辑态，并在保存时归一化为数组
- 修改 `e:\other-code\desktop-tools\src\renderer\App.tsx`
  - 类型：事件处理调整
  - 影响位置：传给 `SettingsPanel` 的 `onAllowedPathsChange` / `onSearchRootsChange`
  - 调整为直接更新文本编辑态
- 可能修改 `e:\other-code\desktop-tools\src\renderer\features\settings\settings-model.ts`
  - 类型：可选工具函数补充
  - 可能新增数组到多行文本的转换函数，避免重复 `join('\n')`

## 实现细节
当前问题代码在 `App.tsx`：

```tsx
onAllowedPathsChange={(value) => {
  updateToolSettings((current) => ({
    ...current,
    allowedPaths: splitMultilineInput(value),
  }));
}}
onSearchRootsChange={(value) => {
  updateToolSettings((current) => ({
    ...current,
    searchRoots: splitMultilineInput(value),
  }));
}}
```

计划改为：

```tsx
onAllowedPathsChange={setAllowedPathsText}
onSearchRootsChange={setSearchRootsText}
```

同时在 `useSettingsState` 中保存时构造 payload：

```ts
toolSettings: {
  allowedPaths: splitMultilineInput(allowedPathsText),
  searchRoots: splitMultilineInput(searchRootsText),
  draftDirectory: values.toolSettings?.draftDirectory ?? '',
}
```

如果 `saveConfigWithValues(values)` 仍需要支持外部传入 `values`，则优先把文本编辑态作为保存来源，避免 `formValues.toolSettings.allowedPaths` 因输入阶段不再同步而过期。

## 边界条件与异常处理
- 在 textarea 末尾按 Enter：必须保留末尾换行，直到保存或关闭设置界面。
- 在 textarea 中间插入空行：编辑期间保留空行；保存时继续通过 `splitMultilineInput` 删除空行，避免保存无效路径。
- 输入只包含空白行：编辑期间可显示；保存后配置数组为空。
- 保存失败：保留当前编辑态，方便用户重试，不丢输入内容。
- 保存成功：用已保存配置刷新编辑态，移除空行与前后空白，保持配置规范化。
- 不改变 API Key、API Base URL、最大工具调用轮数、草稿目录等其他设置字段的行为。

## 数据流路径
修复前：
`textarea 输入` → `splitMultilineInput` → `formValues.toolSettings 数组` → `join('\n')` → `textarea 回显`

修复后：
`textarea 输入` → `allowedPathsText/searchRootsText 编辑态` → `textarea 回显`

保存时：
`allowedPathsText/searchRootsText` → `splitMultilineInput` → `payload.toolSettings.allowedPaths/searchRoots` → `desktopAppClient.saveConfig`

## 预期结果
- “允许打开的路径”输入框中按 Enter 可以正常换行。
- “搜索目录”输入框中按 Enter 可以正常换行。
- 保存后的配置仍以数组形式存储，并继续过滤空行和每行首尾空白。
- 不影响实际 `open_path` 和 `search_files` 的权限/搜索目录读取逻辑。

## 已确认的定位结论
- textarea 渲染位置：`e:\other-code\desktop-tools\src\renderer\features\settings\SettingsPanel.tsx:103`
- 当前即时归一化位置：`e:\other-code\desktop-tools\src\renderer\App.tsx:305`
- 归一化函数：`e:\other-code\desktop-tools\src\renderer\features\settings\settings-model.ts:3`
- 当前数组回显位置：`e:\other-code\desktop-tools\src\renderer\lib\hooks\use-settings-state.ts:115`
