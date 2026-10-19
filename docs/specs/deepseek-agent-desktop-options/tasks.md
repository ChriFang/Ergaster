# DeepSeek Agent 桌面工具 Electron 实现任务计划

- [x] Task 1: 初始化 Electron + TypeScript 桌面应用工程
    - 1.1: 选择 Electron + TypeScript 基础工程结构，区分 main、preload、renderer 代码目录
    - 1.2: 配置 TypeScript、构建脚本、开发启动脚本和 Windows 打包基础配置
    - 1.3: 配置 Renderer 禁用 Node integration，并启用 contextIsolation
    - 1.4: 建立基础 Chat UI 页面、设置入口和应用主窗口

- [x] Task 2: 实现本地配置文件管理
    - 2.1: 设计配置文件结构，包含 DeepSeek API Key、模型名、API Base URL、最大工具调用轮数等字段
    - 2.2: 在 Electron userData 目录下读写配置文件，避免写入项目源码目录
    - 2.3: 实现 Main Process 配置服务，支持读取、保存、校验和默认值填充
    - 2.4: 通过 Preload 暴露 `getConfig`、`saveConfig` 等受控 IPC API
    - 2.5: 在 Renderer 设置界面支持用户配置和修改 DeepSeek API Key
    - 2.6: 确保 API Key 不硬编码、不写入日志、不在普通对话消息中展示

- [x] Task 3: 实现 DeepSeek Agent 调用循环
    - 3.1: 封装 DeepSeek Chat Completion API 客户端，从配置文件读取 API Key、模型名和 API Base URL
    - 3.2: 维护会话 messages，支持用户消息、assistant 消息和 tool 消息
    - 3.3: 发送请求时携带 Tool Registry 生成的 tools schema
    - 3.4: 解析 assistant 普通回复和 `tool_calls` 回复
    - 3.5: 支持工具执行结果回填后再次请求模型生成最终回复
    - 3.6: 设置最大工具调用轮数、请求取消和异常返回

- [x] Task 4: 实现 Tool Registry 和工具参数校验
    - 4.1: 定义 `ToolDefinition`、`ToolRisk`、`ToolContext`、`ToolResult` 等 TypeScript 类型
    - 4.2: 实现工具注册表，将本地工具映射为 DeepSeek `tools` 结构
    - 4.3: 为每个工具声明 JSON Schema，并启用 `strict: true` 与 `additionalProperties: false`
    - 4.4: 使用 Zod 或 AJV 在本地执行前再次校验工具参数
    - 4.5: 对未知工具、非法参数、重复调用和解析失败返回结构化错误

- [x] Task 5: 实现权限确认、执行控制和审计日志
    - 5.1: 为工具定义 low、medium、high 风险等级
    - 5.2: 对中高风险工具通过 Renderer 弹窗请求用户确认
    - 5.3: 为工具执行设置超时、取消和错误捕获
    - 5.4: 记录用户命令、工具名、参数摘要、执行状态、错误信息和时间戳
    - 5.5: 避免日志记录 DeepSeek API Key、完整敏感路径或敏感命令内容

- [x] Task 6: 实现第一批 Windows 本地工具
    - 6.1: 实现 `open_application`，仅允许打开白名单应用
    - 6.2: 实现 `open_path`，仅允许打开配置允许目录内的文件或文件夹
    - 6.3: 实现 `get_system_info`，返回系统版本、CPU、内存、当前用户名等只读信息
    - 6.4: 实现 `search_files`，仅在固定目录下搜索文件
    - 6.5: 实现 `create_text_draft`，在指定安全目录创建文本草稿
    - 6.6: 实现 `run_powershell_template`，仅允许执行预定义模板且执行前确认

- [x] Task 7: 完善 Chat UI 和工具调用展示
    - 7.1: 实现用户输入、发送、加载态、错误态和消息列表
    - 7.2: 展示工具调用名称、参数摘要、执行中状态、成功结果和失败原因
    - 7.3: 实现中高风险工具确认弹窗
    - 7.4: 实现设置页面，用于配置 DeepSeek API Key、模型名和 API Base URL
    - 7.5: 支持取消当前请求或工具执行

- [x] Task 8: 验证安全边界和基础可用性
    - 8.1: 验证 Renderer 无法直接访问 Node.js、文件系统和 shell
    - 8.2: 验证非法工具名、非法参数、越权路径和超时工具会被拒绝或中断
    - 8.3: 验证 DeepSeek API Key 可通过配置文件保存、读取和修改
    - 8.4: 验证 API Key 不出现在日志、对话记录和工具执行结果中
    - 8.5: 验证典型命令可完成从用户输入到工具调用再到最终回复的完整链路
