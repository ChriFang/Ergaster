# 输入记录文件持久化实施总结

## 完成内容
已完成用户输入记录的文件持久化能力，支持启动加载、发送后保存、左侧栏展示以及 100 条上限控制。

## 具体改动

### 主进程文件服务
新增 `src/main/input-history-service.ts`：
- 保存路径固定为 `C:\Users\用户目录\AppData\Roaming\desktop-tools\chat-history`
- 自动创建 `AppData\Roaming\desktop-tools` 目录
- 读取历史记录文件并返回 `string[]`
- 追加新记录时自动插入到头部
- 最多保留 100 条记录
- 文件损坏或 JSON 非法时回退为空数组，并记录错误日志

### IPC 与桥接
修改 `src/main/index.ts`：
- 新增 `history:get-inputs`
- 新增 `history:append-input`

修改 `src/preload/index.ts`：
- 暴露 `getInputHistory()`
- 暴露 `appendInputHistory(entry)`

修改 `src/shared/contracts.ts`：
- 为 renderer 与 preload 之间新增输入记录 API 类型定义

### 前端接入
修改 `src/renderer/App.tsx`：
- 程序初始化时调用 `getInputHistory()`，并将结果展示在左侧栏“输入记录”区域
- 发送消息后先即时更新本地 `inputHistory`
- 再异步调用 `appendInputHistory(prompt)` 持久化到文件
- 使用主进程返回的最新历史列表校正前端状态
- 保留点击历史记录回填输入框的原有交互

## 实现结果
现在已支持：
- 输入记录保存到 `C:\Users\<当前用户>\AppData\Roaming\desktop-tools\chat-history`
- 重启程序后自动读取历史记录并展示
- 最多保留 100 条输入记录
- 历史文件不存在时自动按空列表处理
- 保存失败不会阻断正常聊天发送

## 验证结果
已执行：
- `npm run typecheck`

结果：
- 类型检查通过
