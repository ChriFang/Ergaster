# 自然语言安装 Skill（skill-installer）实现总结

## 成果概述

新增模型可调用的系统工具 `install_skill`，实现"下载 → 校验 → 安全扫描 → 人工确认 → 安装 → 列表刷新"闭环：
用户在会话中用自然语言给出来源（GitHub 仓库/子目录 URL 或 raw SKILL.md URL），模型调用工具后，主进程完成
安全下载与静态扫描，通过高风险确认弹窗展示「将安装内容」预览，用户批准后落盘到 `~/.desktop-agent/skills/`，
默认禁用且不授权任何智能体，并即时刷新应用内 Skills 列表。

## 新增文件

- `src/main/skills/skill-source.ts`：来源归一化（github / .zip / raw SKILL.md）、域白名单、SSRF 主机拦截、zip 条目消毒、zip 根目录定位（`resolveZipSkillBase`）、体积/数量上限常量（纯逻辑）。
- `src/main/skills/skill-scanner.ts`：静态安全扫描（pipe-to-shell、破坏性命令、密钥、可疑网络、提示注入、execute 配置、typosquat），产出 findings + 风险分 + 阻断判定（纯逻辑）。
- `src/main/skills/skill-installer.ts`：编排层——`secureFetch`（手动重定向 + 逐跳白名单 + SSRF + 超时 + 体积上限）、GitHub Contents API 递归拉取子目录、`prepareInstall`（暂存 + 预览）、`commitInstall`（落盘）。
- `src/main/skills/skill-source.test.ts`、`src/main/skills/skill-scanner.test.ts`：两套纯逻辑单测（共 15 例）。

## 修改文件

- `src/shared/user-skills.ts`：新增 `InstalledSkillFile` / `ScanFinding` / `ScanReport` / `ResolvedSource` 类型。
- `src/shared/skill-contracts.ts`：新增 `SkillsChangedEvent` 类型。
- `src/main/skills/user-skills-service.ts`：新增 `installSkillTree`（防重名、原子落盘、强制 enabled=false、注册内存态）、`listNames`、`onSkillsChanged/emitSkillsChanged`，并在 create/update/delete/install 后触发推送。
- `src/main/tools/tool-registry.ts`：新增 `installSkillSchema` 与 `install_skill` 工具对象，注册进 `registeredTools`（普通聊天可见），`risk:'high'`，`buildConfirmation` 调 `prepareInstall`、`execute` 调 `commitInstall`。
- `src/shared/contracts.ts`、`src/preload/index.ts`、`src/renderer/lib/desktop/desktop-app-client.ts`、`src/main/index.ts`：`skills:changed` 推送四层同步。
- `src/renderer/lib/hooks/use-chat-session.ts`、`src/renderer/features/skills/SkillsPanel.tsx`：订阅 `onSkillsChanged` 后即时刷新列表。
- `package.json`：`test` 脚本两处列表登记两个新测试文件。

## 安全设计要点

- 三道闸：下载前限域（白名单 github/codeload/raw.githubusercontent/skills.sh/mcp-proxy.baidu-int.com + SSRF 私网拦截）、执行前人审（`risk:'high'` 必弹确认、不可自动执行、无人值守直接拒绝）、装后默认不生效（`enabled:false`、不授权任何智能体）。
- 解包 zip-slip 消毒 + 单文件/总体积/文件数上限；下载超时 + AbortSignal + 手动重定向逐跳复检。
- 扫描命中阻断级规则在 `buildConfirmation` 直接抛错（预检失败，不弹窗、不安装）；warn 级仅提示并计入风险分。
- `buildConfirmation` 与 `execute` 共享内存暂存，用户批准的字节与最终落盘字节一致，杜绝 TOCTOU；execute 找不到暂存即报错，绝不重新下载后静默安装。

## 实现取舍

- GitHub 源按子目录逐文件拉取（Contents API + raw 下载），只取目标子目录、不下载整仓，规避大仓 zipball 触发下载上限；未引入新依赖。
- `onSkillsChanged` 仅在 create/update/delete/install 时触发（不含 reload），避免与 SkillsPanel 的 reload+list 形成刷新回环；渲染层推送处理器只做 `listSkills` 轻量重列。
- 安装写盘复用服务层（`installSkillTree`）走临时目录 + rename 原子落盘，并复用 `loadSkillFromDirectory` 注册内存态，保持内存/磁盘一致。

## 验证结果

- `npm run typecheck`（tsconfig.json + tsconfig.node.json）通过。
- `npm test` 全部通过：339 例、0 失败（含新增 skill-source 10 例、skill-scanner 7 例）。

## 后续可选（二期）

- 多文件写盘的 SKILL.md `enabled` 补丁目前经 YAML 重序列化（保留 execute/license/allowedTools，但丢失注释/原始排版）。
- 重名 Skill 的"显式替换"（先卸载再装）与来源白名单的可配置化 UI。
- `install_skill` 落在 `registeredTools` 已由静态位置（http_request 与 run_command 之间）与 typecheck 保证；建议启动应用后用 `[tools] catalog:` 日志再确认运行态清单。
