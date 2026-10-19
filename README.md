# Ergaster

> 一个把「大模型 + 本地 Windows 能力」装进桌面的 AI Agent 工作台。
> 名字取自希腊语 *ἐργαστήρ*（工匠、作坊）——一个可以动手干活的工作间。

Ergaster 基于 Electron + React 构建，把 DeepSeek 等模型的推理能力，与本地文件、文档、命令行、
Office 文件、邮件、剪贴板、外网请求等真实操作能力连起来：模型多轮思考、按需调用工具，**高风险动作
一律先弹审批，由用户点确认后才执行**。

---

## 1. 它能做什么

| 能力域 | 说明 |
| --- | --- |
| 多轮 Agent 对话 | 流式输出，推理过程（reasoning）与最终回答分开呈现；工具调用与结果以卡片折叠展示 |
| 会话管理 | 多会话、按智能体隔离上下文、重命名/删除、分段存储与懒加载分页、未读标记、输入历史（↑/↓ 调起） |
| 工具调用审批 | 每个工具带 `low/medium/high` 风险等级，命中白名单可自动执行，其余走确认卡 |
| Skills | 用户自定义能力，`SKILL.md`（YAML frontmatter + Markdown）驱动；支持内容型与工具型，可从 GitHub 安装 |
| Agents | 可切换的智能体配置单元：system prompt + MCP 绑定 + Skills 边界 |
| MCP | 以 stdio 方式接入外部 MCP Server，把其工具动态注入当前智能体 |
| 工作流 | 内置「辩论」与「深度研究」两种多角色工作流，另支持自定义工作流（可视化节点编排），可导出报告 |
| 代码工程 | 把本地仓库纳入上下文，提供 `code_read_file` / `code_write_file` / `code_edit_file` / `code_grep` / `code_glob` 等带作用域校验的文件工具 |
| 文档与表格 | 生成 txt/md/docx/pdf/xlsx/图片草稿，读写 Excel、抽取 Word/PPT/PDF 文本、解压与下载 |
| 邮件 | IMAP 只读检索（账户、邮箱、检索、读信、已读标记），密码经 `safeStorage` 加密落盘 |
| 长期记忆 | `memory_add` / `memory_search` / `memory_forget`，自动注入并节流抽取 |
| 定时任务 | 按调度规格自动运行 Agent 任务（进程内调度器） |
| 交互式 UI 组件 | 模型可产出沙箱 HTML 卡片或结构化表单（`ui_form`）向用户取参数，支持独立窗口 |
| 桌面集成 | 系统托盘常驻、关闭按钮行为可配（询问/最小化/退出）、外链走系统浏览器 |

## 2. 技术栈

- **桌面壳**：Electron 41（`contextIsolation: true`、`nodeIntegration: false`、preload + contextBridge）
- **渲染层**：React 19 + TypeScript + Vite 6，`react-markdown` + `remark-gfm`
- **主进程**：Node.js，`@modelcontextprotocol/sdk`（MCP）、`zod`（工具参数校验）、`yaml`（Skill frontmatter）
- **文档能力**：`docx`、`exceljs`、`pdfkit`、`mammoth`、`pdf-parse`、`jszip`、`imapflow`、`mailparser`
- **构建打包**：`esbuild`（main/preload）、`vite`（renderer）、`electron-packager`（分发）
- **测试**：`node:test` + `assert`，经 esbuild 打包后直接跑，无额外框架

## 3. 目录结构

```
src/
├── main/                  Electron 主进程：能力中枢
│   ├── index.ts           应用入口：窗口、IPC 注册、生命周期
│   ├── agent/             Agent 运行时（会话循环、模型客户端、推理参数、标题生成）
│   ├── tools/             工具注册中心 + 系统工具 + 审批/自动执行 + 文档/压缩/下载引擎
│   ├── skills/            用户 Skills 扫描、安装、编辑
│   ├── agent-profiles/    智能体（Agent Profile）持久化
│   ├── mcp/               MCP 客户端与配置
│   ├── workflow/          工作流服务、定义持久化、内置 runner、报告导出
│   ├── code/              代码工程、文件作用域、diff、代码工具
│   ├── conversation/      会话、消息分段、附件
│   ├── mail/              邮件账户、IMAP、邮件工具（以 Capability Module 形式接入）
│   ├── memory/            长期记忆
│   ├── scheduler/         定时任务与调度器
│   ├── capabilities/      内部能力模块注册表（新增功能域的登记点）
│   ├── core/              配置、日志审计、路径、调试开关、模型列表
│   ├── tray/              系统托盘
│   └── ui-window/         模型驱动的交互式窗口
├── preload/               contextBridge 桥接层，唯一 IPC 出口
├── renderer/              React UI（features 按功能域切分 + lib/hooks 状态）
└── shared/                主/渲染共享类型与纯函数（配置、契约、工具、工作流…）
```

## 4. 快速开始

```bash
npm install            # 安装依赖
npm run dev            # 开发：vite + esbuild watch + electronmon 联调
npm run typecheck      # 类型检查（渲染层 + node 侧两套 tsconfig）
npm test               # 单元测试
npm run build          # 生产构建，产物在 dist/
npm run dist:win64     # 打包 Windows x64，产物在 release/
```

首次启动后到「设置 → 通用」填入 API Key 与模型名，即可开始对话。

## 5. 数据位置

| 位置 | 内容 |
| --- | --- |
| `%APPDATA%\Ergaster\`（mac/Linux 为 Electron `userData`） | `config.json`（含密钥，回显时脱敏）、`test.ini`（调试开关）、`log/`（`main.log`、`audit.log`、`dump-req.log`） |
| `~/.ergaster/` | `skills/`、`agents/`、`workflows/`、`conversations/`、`code-projects/`、`code-edits/`、`scheduled-tasks/`、`memory/memory.json`、`mail-accounts.json`、`mcp.json` |
| `~/Documents/ErgasterDrafts/` | 草稿默认输出目录（可在设置中改） |
| 渲染层 localStorage | 输入历史、上次激活的会话、`/` 指令最近使用 |

> **从 Desktop Agent 升级说明**：本版本将应用名由 `Desktop Agent` 改为 `Ergaster`，数据目录随之变为
> `%APPDATA%\Ergaster` 与 `~/.ergaster`，**不做自动迁移**。若想保留旧数据，退出应用后把
> `%APPDATA%\Desktop Agent` 拷到 `%APPDATA%\Ergaster`、`~/.desktop-agent` 拷到 `~/.ergaster` 即可。

## 6. 文档索引

- [项目架构与脉络](doc/项目架构与脉络.md)：分层、启动链路、Agent 主链路、持久化分布、局限与扩展点
- [Skills 使用说明](doc/skills/skills-examples/README.md)
- [附件输入与持久化设计](doc/附件输入与持久化设计.md)
- [会话消息分段存储与懒加载分页设计](doc/会话消息分段存储与懒加载分页设计.md)
- [工作流设计](doc/workflow-design/custom-workflow-editor-design.md)
- [MCP 需求](doc/MCP.md)

## 7. 安全边界（设计取舍）

- 渲染进程无文件系统权限，所有敏感动作经 preload 暴露的 `window.desktopApp` 契约进入主进程
- 工具执行前统一过 `requestToolConfirmation()`；命令类工具叠加白名单/黑名单，下载类工具叠加域名白名单
- 文件访问限定在「工具设置」的允许目录内；代码工程另有独立的可写开关与作用域校验
- 密钥只存盘与主进程内使用，下发到界面的永远是掩码串
