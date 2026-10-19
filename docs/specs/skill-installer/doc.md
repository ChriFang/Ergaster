# 自然语言安装 Skill —— 方案设计（feature: skill-installer）

> 目标：新增一个模型可调用的系统工具 `install_skill`，按用户指定来源自动下载 Skill、
> 校验完整性与安全风险、经人工确认后安装到 `~/.desktop-agent/skills/`，并刷新应用内 Skills 列表。
> 本方案采纳的边界选择：来源 = GitHub 仓库/子目录 + raw SKILL.md URL；结构 = 完整目录（多文件）；
> 安全 = 强制人工审查、装后默认禁用；下载 = 可信域白名单 + SSRF 防护。

## 1. 需求场景与处理逻辑

典型链路（会话内自然语言触发）：
1. 用户："帮我安装这个 skill：https://github.com/owner/repo/tree/main/skills/pdf"
2. 模型调用 `install_skill({ source })`。
3. 主进程按来源类型下载到内存暂存：
   - raw SKILL.md URL → 直接取文本，构成单文件 Skill；
   - `.zip` 包 URL（如 mcp-proxy 永久下载链接）→ 下载后用 jszip 解包（zip-slip 消毒），以最浅 SKILL.md 目录为根抽取整棵子树；
   - GitHub 仓库/子目录 → 经 GitHub Contents API 递归列目录、逐文件从 raw 下载（仅拉取该子目录，不下载整仓）。
4. 解析 frontmatter → 完整性校验 → 安全扫描，产出风险报告 + 「将安装内容」预览。
5. 通过高风险确认弹窗展示预览（名称/描述/来源/文件清单/命中风险/SKILL.md 正文）。
6. 用户批准后，将【与预览完全一致的字节】写入 `skills/<name>/`，强制 `enabled:false`、不授权任何 Agent。
7. reload 内存态并推送 `skills:changed`，Skills 列表与智能体编辑器即时刷新。
8. 用户拒绝 / 校验失败 / 扫描判定阻断 / 下载失败：不落盘，把明确原因作为工具结果回给模型。

## 2. 架构与技术方案

分层遵循 `renderer -> preload -> main -> shared`，新增能力优先复用既有 service / tool registry / 审计。

模块切分（关键：把可测纯逻辑与网络/Electron 副作用分离，满足"测试环境无 Electron"约束）：

| 模块 | 位置 | 职责 | 可单测 |
|---|---|---|---|
| `skill-source.ts` | src/main/skills/ | 来源归一化、域白名单、SSRF 主机校验、zip 条目消毒(zip-slip)、体积/数量上限常量 | 是（零依赖） |
| `skill-scanner.ts` | src/main/skills/ | 静态安全扫描：产出 findings + 风险分 + 是否阻断 | 是（零依赖） |
| `skill-installer.ts` | src/main/skills/ | 编排：secureFetch + jszip 解包 → 调用 source/scanner → 内存暂存 → 落盘 | 否（网络/IO） |
| `user-skills-service.ts` | src/main/skills/ | 新增 `installSkillTree()` 写整棵目录 + `onSkillsChanged` 事件 | 部分 |
| `tool-registry.ts` | src/main/tools/ | 新增 `install_skill`（进 registeredTools）+ schema | — |

数据流（安装一次的时序）：

```
model → install_skill(source)
  → [buildConfirmation]  // 高风险工具在弹窗前执行
      skill-source.resolve(source)         // 归一化 + 白名单 + 类型判定
      skill-installer.download()           // secureFetch（手动重定向 + 逐跳白名单 + SSRF）
      (github) JSZip.loadAsync + 消毒抽取   // zip-slip 防护
      skill-source.parse + 完整性校验
      skill-scanner.scan(files)            // findings + score + blocked
      stage(cacheKey, {files, report})     // 内存暂存被批准的确切字节
      return { summary, detail(风险报告), diff(SKILL.md 正文) }
  → 确认弹窗（用户看到预览）
  → [execute]
      读取 stage(cacheKey)                  // 无暂存则报错，杜绝 TOCTOU
      userSkillsService.installSkillTree(files, { enabled:false })
      userSkillsService 触发 onSkillsChanged
  → index.ts: webContents.send('skills:changed')
  → renderer 重新拉取 listSkills()
```

说明：`buildConfirmation` 与 `execute` 通过 installer 内的模块级暂存表共享"已下载已扫描"的产物，
避免二次下载，也保证用户批准的内容与最终落盘字节一致（TOCTOU 关闭）。

## 3. 安全模型（本方案核心）

调研结论支撑（2026）：Agent Skills 生态默认无签名/无审查/无沙箱；Snyk ToxicSkills 抽检 3984 个第三方
skill，13.4% 存在严重问题、76 个确认恶意；"三行 markdown 即可拿 shell"。故"模型自动下载+安装"必须以
"下载前限域、执行前人审、装后默认不生效"三道闸收口。

1. 传输面：仅允许白名单域（github.com / api.github.com / codeload.github.com / raw.githubusercontent.com
   / skills.sh / mcp-proxy.baidu-int.com）；`secureFetch` 手动处理重定向并逐跳复检域名，拦截私网/环回/链路本地/云元数据地址
   (169.254.169.254)；请求有体积上限、超时与 AbortSignal。
2. 解包面：jszip 抽取时对每个条目做路径消毒，拒绝绝对路径与 `..` 逃逸(zip-slip)，限制文件数/总体积/单文件体积。
3. 校验面：frontmatter 必含 name/description；name 必须匹配 `^[a-z][a-z0-9-]{0,63}$`；与既有 skill 重名
   不静默覆盖（报错让用户改名或显式替换）；SKILL.md 行数/体积上限。
4. 扫描面：见 §5 规则；命中"阻断级"规则时 `buildConfirmation` 直接抛错（预检失败，不弹窗、不安装）。
5. 执行面：工具 `risk:'high'` → 必然弹确认、`canAutoRun=false`（不可加入自动执行清单）、无人值守链路直接拒绝。
6. 生效面：安装后强制 `enabled:false` 且不写入任何 Agent 的 skillNames；用户须在 Skills 面板显式启用+授权后才进运行时工具集。

## 4. 影响文件

新增（src/main/skills/）：
- `skill-source.ts`：来源解析。导出 `resolveSkillSource(input): ResolvedSource`、`isAllowedHost(url)`、
  `assertNoSsrf(url)`、`sanitizeZipEntryPath(name): string|null`、上限常量。
- `skill-scanner.ts`：`scanSkill(input: ScanInput): ScanReport`。
- `skill-installer.ts`：`prepareInstall(source, signal)`（下载+解包+校验+扫描+暂存，返回预览）、
  `commitInstall(source, signal)`（落盘）、`secureFetch()`、模块级 `stagingCache`。
- 测试：`skill-source.test.ts`、`skill-scanner.test.ts`。

修改：
- `src/shared/user-skills.ts`：新增 `InstalledSkillFile`（{ relativePath, text|contentBase64 }）、`ScanFinding`、
  `ScanReport`、`ResolvedSource` 类型。
- `src/main/skills/user-skills-service.ts`：新增 `installSkillTree(files, opts)`（校验名、防重名、写整棵子树、
  强制 enabled:false、注册内存态、更新 skillFileStats）；新增 `onSkillsChanged(listener)` / 私有 `emitSkillsChanged()`，
  并在 create/update/delete/reload/install 后触发。
- `src/main/tools/tool-registry.ts`：新增 `installSkillSchema`（顶部 schema 区）与 `install_skill` 工具对象，
  **插入 `registeredTools` 数组内**（锚点：`http_request` 工具对象之后；切勿落入 codeTools/codeWriteTools —— 见记忆教训）；
  execute/buildConfirmation 调 skill-installer。
- `src/shared/contracts.ts`：`DesktopAppApi` 增 `onSkillsChanged(listener)`；新增 `SkillsChangedEvent` 类型。
- `src/preload/index.ts`：暴露 `onSkillsChanged`（订阅 `skills:changed`，返回 unsubscribe，比照 `onConversationChanged`）。
- `src/renderer/lib/desktop/desktop-app-client.ts`：透传 `onSkillsChanged`。
- `src/main/index.ts`：`app.whenReady` 内接线
  `userSkillsService.onSkillsChanged(e => mainWindow?.webContents.send('skills:changed', e))`（发送前判窗口存活）。
- `src/renderer/lib/hooks/use-chat-session.ts`：订阅 `onSkillsChanged` 后重拉 `listSkills()`（现仅挂载时拉一次）。
- `src/renderer/features/skills/SkillsPanel.tsx`：挂载时订阅 `onSkillsChanged` 自动刷新列表。
- `package.json`：`test` 脚本两处列表各登记两个新测试文件（esbuild 打包列表 + node --test 运行列表，漏一处不执行）。

## 5. 关键实现细节

### 5.1 工具定义（tool-registry.ts，进 registeredTools）

```ts
// 顶部 schema 区
const installSkillSchema = z.object({
  source: z.string().min(1).max(2048), // GitHub 仓库/子目录 URL 或 raw SKILL.md URL
});

// registeredTools 内（http_request 工具对象之后）
{
  name: 'install_skill',
  description:
    '从用户指定来源安装一个 Skill：支持 GitHub 仓库/子目录 URL 或 raw SKILL.md URL。'
    + '工具会下载、做完整性校验与安全扫描，并在用户确认后安装；安装后默认禁用，需用户手动启用。'
    + '仅在用户明确要求安装某个 skill 时调用；source 必须是用户提供或用户确认过的地址。',
  risk: 'high',
  strict: true,
  parameters: {
    type: 'object',
    properties: { source: { type: 'string', description: 'GitHub 仓库/子目录 URL 或 raw SKILL.md URL' } },
    required: ['source'],
    additionalProperties: false,
  },
  validator: installSkillSchema,
  timeoutMs: commandToolTimeoutMs, // 下载+解包留足时间
  source: { type: 'system' },
  buildConfirmation: async (args) => {
    const input = args as z.infer<typeof installSkillSchema>;
    const preview = await prepareInstall(input.source); // 下载+校验+扫描+暂存；阻断级风险在此 throw
    return { summary: preview.summary, detail: preview.detail, diff: preview.skillMarkdown };
  },
  execute: async (args, context) => {
    const input = args as z.infer<typeof installSkillSchema>;
    return commitInstall(input.source, context.signal); // 读暂存并落盘；无暂存则报错
  },
},
```

### 5.2 安全扫描规则（skill-scanner.ts，纯函数）

```ts
export type ScanFinding = {
  severity: 'info' | 'warn' | 'block';
  code: string;         // PIPE_TO_SHELL / DESTRUCTIVE_CMD / SECRET / INJECTION / EXECUTE_SCRIPT ...
  message: string;
  file?: string;        // 命中文件相对路径
};
export type ScanReport = { score: number; findings: ScanFinding[]; blocked: boolean };
```

扫描维度（对 SKILL.md 正文与所有随附脚本文本执行）：
- 管道执行：`curl|wget|iwr … | (sh|bash|iex)` → block。
- 破坏性命令：`rm -rf` / `Remove-Item -Recurse -Force` / `format ` / `del /f` / `mkfs` / `dd if=` → block。
- 凭证外泄：AKIA / `ghp_` / `sk-` / PRIVATE KEY 头、读 env 或凭证并外发的启发式 → warn/block。
- 可疑网络：硬编码 IP、非白名单域、超长 base64 块 → warn。
- 提示注入：SKILL.md 中 "ignore previous instructions" / "disregard above" / "you are now" 等 → warn。
- frontmatter.execute：`type:'script'` 或 `type:'http'` → block；`type:'tool'` 指向 run_command /
  run_powershell_template / http_request / code_write_file 等高危工具 → block。
- 名称：非法 / 含非 ASCII 同形字 / 与既有 skill 近似(编辑距离≤1) 疑似 typosquat → warn。

阻断策略：任一 `block` 级 finding ⇒ `blocked=true`；`prepareInstall` 见到 blocked 直接 throw，
弹窗都不弹（预检失败）。`warn` 级不阻断但计入风险分并在确认弹窗 detail 中醒目列出，交用户裁量。

### 5.3 下载与暂存（skill-installer.ts，主进程）

```ts
const stagingCache = new Map<string, StagedInstall>(); // key = 归一化 source

export async function prepareInstall(source: string, signal?: AbortSignal): Promise<InstallPreview> {
  const resolved = resolveSkillSource(source);          // 白名单/类型；非法直接 throw
  const files = resolved.kind === 'raw-md'
    ? [await fetchRawSkillMd(resolved, signal)]
    : await fetchGithubSkillTree(resolved, signal);     // codeload zipball + jszip + zip-slip 消毒
  const { metadata, body } = parseSkillMarkdown(readSkillMd(files));
  assertIntegrity(metadata, files);                     // name/description/正则/体积/数量
  const report = scanSkill({ metadata, body, files, existingNames: userSkillsService.listNames() });
  if (report.blocked) throw new Error(buildBlockedMessage(report));
  stagingCache.set(normalize(source), { name: metadata.name, files, report });
  return { summary: `将安装 Skill「${metadata.name}」（${files.length} 个文件，风险分 ${report.score}）`,
           detail: buildReportDetail(resolved, files, report), skillMarkdown: readSkillMd(files) };
}
```

## 6. 边界条件与异常处理

- 来源非白名单域 / 非 http(s) / 解析失败 → prepareInstall throw，工具错误回模型，不弹窗。
- GitHub 子目录内无 SKILL.md、或含多个 SKILL.md（歧义）→ 报错要求指定确切子目录。
- 重名：默认拒绝并提示（不静默覆盖）；"显式替换"（先卸载再装）留待二期。
- 下载超时/中断：AbortSignal 生效，暂存不写；jszip 解包超限（文件数/体积）→ 报错。
- 确认阶段用户拒绝 → 框架返回"用户拒绝"，execute 未触发即不落盘；暂存待同源覆盖或进程结束回收。
- execute 找不到暂存（异常路径）→ 明确报错，绝不重新下载后静默安装（防 TOCTOU）。
- 推送发送前判 `mainWindow` 存活，避免向已销毁窗口发送。

## 7. 数据流路径

`renderer(会话) → agent:run → agentService → executeToolCall → executeDefinedToolCall`
`→ buildConfirmation(下载/扫描/暂存) → tool:confirm 弹窗 → execute(落盘)`
`→ userSkillsService.installSkillTree → onSkillsChanged → index.ts webContents.send('skills:changed')`
`→ preload onSkillsChanged → use-chat-session / SkillsPanel 重拉 listSkills`。
落盘目录：`~/.desktop-agent/skills/<name>/`（SKILL.md + 随附文件）；审计经 audit-log 记录工具执行明细。

## 8. 预期结果

- 模型可经 `install_skill` 完成"下载→校验→扫描→人审→安装→刷新"闭环，全程可取消、可审计。
- 恶意/高危 skill 在预检即被阻断，或在确认弹窗充分暴露风险；安装物默认不生效，无越权。
- Skills 面板与智能体编辑器在安装后即时出现新条目（enabled=false）。
- `npm run typecheck` 与 `npm test`（含两个新纯逻辑测试）通过。

## 9. 测试计划

- `skill-source.test.ts`：白名单/拒绝私网、URL 归一化（repo、/tree/ref/subdir、raw）、zip 条目消毒（`..`/绝对路径/正常）。
- `skill-scanner.test.ts`：各 block/warn 规则命中与放行、execute 配置判定、typosquat、风险分与 blocked。
- 手动联调：真实 GitHub 单目录 skill 与 raw SKILL.md 各一，验证弹窗预览、默认禁用、列表刷新。

## 10. 修订：GitHub 源改为按子目录拉取

背景：初版用 codeload 整仓 zipball + jszip 解包，命中 `MAX_DOWNLOAD_BYTES`（20MB）——即便目标 skill 子目录很小，
整仓（如 36MB）也会被拦截（实测 affaan-m/ECC 的 ios-icon-gen）。

变更：`fetchGithubSkillTree` 改为经 GitHub Contents API（`/repos/{o}/{r}/contents/{subdir}?ref=`）递归列目录，
逐文件从 `download_url`（raw 域）下载，仅拉取该子目录。ref 为 `HEAD` 时省略 `?ref=`（走默认分支）。
移除整仓 zipball、`ResolvedSource.zipUrl` 与 `buildZipUrl`；不再经 jszip。

效果：小 skill 从大仓安装不再受整仓体积影响，仅受单文件（2MB）/总量（5MB）/文件数（200）上限约束；
`MAX_DOWNLOAD_BYTES` 仅用于目录列表 JSON 的响应上限。api.github.com 已在白名单内。
代价：每个目录 1 次 API 调用（未认证 60 次/时限额），raw 文件下载不计入该限额。

## 11. 修订：新增 .zip 来源与 mcp-proxy 白名单

- 白名单新增 `mcp-proxy.baidu-int.com`（内部 MCP 代理的 Skill 永久下载域）。
- 新增来源类型 `zip`：URL 末段以 `.zip` 结尾（任意白名单域）即按 zip 包处理，下载后 jszip 解包 + zip-slip 消毒，
  以 `resolveZipSkillBase`（纯函数，可测）定位最浅 SKILL.md 目录为根抽取子树，唯一性歧义/缺失即报错。
- `resolveSkillSource` 分派调整为：github.com → github；末段 `.zip` → zip；末段 `SKILL.md` → raw-md；否则报错（raw/zip 判定不再限定具体域）。
- 复用既有依赖 jszip；沿用统一体积/数量/超时/SSRF 与"装后默认禁用"等全部安全约束。
- 注意：若 mcp-proxy 的下载链接 302 重定向到非白名单域（如对象存储），`secureFetch` 会拦截；届时需把目标域也加入白名单。
