# OpenClaw 插件（Plugin）系统：实现思想与架构梳理

> 本文基于对仓库 `d:\opensrc\openclaw-main` 源码与官方文档的通读整理，面向想理解 OpenClaw 插件机制的工程师。
> 主要依据：`docs/plugins/*`（权威文档）、各目录的 `AGENTS.md`（设计约束）、`src/plugins/*`（加载器）、`src/plugin-sdk/*`（公共契约）、`extensions/*`（捆绑插件实例，共 165 个）。
> 文末附「参考文件清单」便于逐条核对。

---

## 1. 一句话概括

OpenClaw 的插件系统是一个 **“小内核 + 强插件”** 的架构：核心（core）只提供**通用契约**与**调度/生命周期治理**，所有可选能力（渠道、模型供应商、工具、后台服务等）都下沉到插件边缘实现。插件通过**声明式清单（manifest）**被“先发现、后加载”，并通过一层**类型化的公共 SDK 契约（`openclaw/plugin-sdk/*`）**与核心交互，从不直接触碰核心内部实现。

整个系统有两条贯穿始终的主线：

1. **控制面（control plane）与运行时面（runtime plane）严格分离** —— 发现、配置校验、安装、激活规划只依赖清单元数据，**不执行插件代码**；只有真正要跑业务时才惰性加载运行时模块。
2. **一个职责只有一个 owner** —— core 拥有共享的消息工具、动作词汇、调度；渠道拥有账户/安全/会话/传输契约；供应商拥有鉴权/目录/onboarding。任何能力都能追溯到唯一的权威所有者。

---

## 2. 核心设计思想（设计哲学）

这些原则在根 `AGENTS.md`、`src/plugin-sdk/AGENTS.md`、`src/plugins/AGENTS.md`、`extensions/AGENTS.md` 中被反复强调，是理解一切实现细节的前提。

### 2.1 小内核，强插件（Small core, capable plugins）
- 面向模型的 core 新增都有**持续的上下文成本**，因此可选能力属于“边缘”，core 只提供通用契约。
- “多了一个集成”本身**不构成**在 core 新增工具/管理器的理由。
- 新增能力必须沿「能力阶梯」自底向上选择最先契合的一层（见 §2.4）。
- 产品范围由 `VISION.md` 拥有，不随便扩张。

### 2.2 一个职责一个 owner（One owner per responsibility）
- owner 负责**做决定或修改权威状态**；调用方只消费它的操作与已记录事实。
- Adapter 只做契约翻译；缓存/投影都从 owner 派生，并带显式失效生命周期。
- 不同传输（transport）可以有不同 adapter，但**绝不允许出现竞争性的 owner**。

### 2.3 稳定的会话上下文（Stable conversation context）
- 重建历史上下文会破坏 prompt 前缀复用，因此生成的 prompt/工具/上下文增量必须**有界且确定**。
- 保留 transcript 字节、完整下发必需指令；只有压缩（compaction）才改写历史。

### 2.4 能力阶梯（Capability ladder）
新增能力时，按顺序选择**第一个能表达真实需求**的层级（出自 `src/plugin-sdk/AGENTS.md#choose-the-capability-surface`）：

1. 扩展现有 owner，或复用现成的 command / skill / plugin / 集成。
2. 使用现有插件契约（bundle 插件装 skills/MCP/配置；code 插件装运行时 hook/provider/channel/tool）。
3. 契约缺失时，定义一个**窄的通用 core/SDK 能力**，并把现有实现与调用方一起迁移上去。
4. 只有当需求是根本性的、且现有扩展点都无法表达时，才新增“通用 core 面”。新增 hook 必须有具体消费者。

### 2.5 Manifest-first 与控制面/运行时面分离
- 清单/配置校验必须**仅凭元数据**工作，不执行插件代码。
- 原生能力发现**可以**加载受信任的入口代码来构建一个“非激活”的注册表快照。
- 真正的运行时行为来自插件 `register(api)` 且 `api.registrationMode === "full"` 的路径。
- 这让 OpenClaw 能在完整运行时激活之前就校验配置、解释缺失/禁用的插件、生成 UI/schema 提示。

### 2.6 公共契约边界（SDK boundary）
- `src/plugin-sdk/**` 是插件与 core 之间**唯一**的公共契约。
- 插件只能从 `openclaw/plugin-sdk/*` 和自身本地 barrel（`./api.ts`、`./runtime-api.ts`）导入，**不得**深入 `src/channels/**`、`src/agents/**`、`src/plugins/**` 等内部实现。
- 偏好**窄的、目的单一的子路径**，而非宽泛的便利 barrel；热路径入口（channel 启动）保持“模块加载即廉价”，重运行时放 `*.runtime` 子路径。
- 不给捆绑插件开“私有后门”——bundled 和第三方插件看到的是**同一个边界**。

### 2.7 值边界（Plugin value boundary）
- 插件在 load/registration 时被**一次性准入**；此后所有加载的插件都按**引用**传值。
- 插件把值交给 host 后**不得再修改**；host 不做逐值拷贝或深校验，只维护调用作用域与生命周期归属。

### 2.8 惰性与进程稳定（Laziness & process-stable metadata）
- 发现/激活流程**不得**在元数据够用时就急切 import 插件运行时 barrel。
- Gateway 运行期间插件元数据是稳定的：复用快照/安装记录/查找表，避免逐调用 stat/read/hash。元数据变化需要重启或插件 owner 的显式 reload/install/doctor。

---

## 3. 顶层架构：四层模型

OpenClaw 插件系统分四层（`docs/plugins/architecture.md`）：

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Manifest + Discovery  清单与发现                           │
│    从 配置路径 / workspace 根 / 全局插件根 / 捆绑插件 收集候选  │
│    先读原生 openclaw.plugin.json，再读兼容 bundle 清单          │
├─────────────────────────────────────────────────────────────┤
│ 2. Enablement + Validation  启用与校验                        │
│    判定 enabled / disabled / blocked / 独占槽(如 memory) 选中  │
│    仅凭 清单+schema 元数据，可在不跑插件代码时完成              │
├─────────────────────────────────────────────────────────────┤
│ 3. Runtime Loading  运行时加载                                │
│    原生插件在进程内加载，register() 把能力注册进中央注册表      │
│    托管实例按需编译 TS 源；兼容 bundle 归一为注册表记录(不执行) │
├─────────────────────────────────────────────────────────────┤
│ 4. Surface Consumption  面消费                                │
│    其余部分读注册表，暴露 工具/渠道/供应商设置/hooks/HTTP 路由/ │
│    CLI 命令/服务 等                                            │
└─────────────────────────────────────────────────────────────┘
```

关键设计边界：**配置/清单校验**无需执行插件代码；**能力发现**可加载受信入口构建非激活快照；**运行时行为**才走 `register(api)` 的 `full` 模式。失败的注册会在诊断里保持可见（贡献被回滚），但不进入执行作用域，也不阻塞健康插件。

---

## 4. 能力模型（Capability model）

“能力（capability）”是 OpenClaw 对外的**原生插件模型**。一个插件可以注册一种或多种能力类型，注册方法都挂在 `register(api)` 回调拿到的 `OpenClawPluginApi` 上（`docs/plugins/architecture.md#public-capability-model`）：

| 能力 | 注册方法 | 示例插件 |
|------|----------|----------|
| 文本推理 | `api.registerProvider(...)` | `anthropic`, `openai` |
| CLI 推理后端 | `api.registerCliBackend(...)` | `anthropic`, `openai` |
| 向量嵌入 | `api.registerEmbeddingProvider(...)` | provider 自带的向量插件 |
| 语音合成 | `api.registerSpeechProvider(...)` | `elevenlabs`, `microsoft` |
| 实时转写 | `api.registerRealtimeTranscriptionProvider(...)` | `openai` |
| 实时语音 | `api.registerRealtimeVoiceProvider(...)` | `google`, `openai` |
| 媒体理解 | `api.registerMediaUnderstandingProvider(...)` | `google`, `openai` |
| 会议转录源 | `api.registerTranscriptSourceProvider(...)` | `discord`, `google-meet`, `teams-meetings`, `zoom-meetings` |
| 图像生成 | `api.registerImageGenerationProvider(...)` | `fal`, `google`, `openai` |
| 音乐生成 | `api.registerMusicGenerationProvider(...)` | `fal`, `google`, `minimax` |
| 视频生成 | `api.registerVideoGenerationProvider(...)` | `fal`, `google`, `qwen` |
| 网页抓取 | `api.registerWebFetchProvider(...)` | `firecrawl` |
| 网页搜索 | `api.registerWebSearchProvider(...)` | `brave`, `firecrawl`, `google` |
| 渠道/消息 | `api.registerChannel(...)` | `matrix`, `msteams`, `telegram` |
| Gateway 发现 | `api.registerGatewayDiscoveryService(...)` | `bonjour` |
| 迁移 | `api.registerMigrationProvider(...)` | `migrate-claude`, `migrate-hermes` |

> 另有「独占槽（exclusive slots）」：**上下文引擎**与**记忆能力**同一时刻只有一个生效，后注册者替换前者（见 `docs/plugins/sdk-overview/memory-and-context`）。

### 4.1 插件形态（Plugin shapes）
OpenClaw 根据插件**实际注册行为**（而非静态元数据）把每个已加载插件归类：

- **plain-capability**：只注册一种能力（如 provider-only 的 `arcee`、`chutes`）。
- **hybrid-capability**：注册多种能力（如 `openai` 同时拥有文本推理、语音、媒体理解、图像生成）。
- **hook-only**：只注册 hooks，无能力/工具/命令/服务。
- **non-capability**：注册工具/命令/服务/路由，但无能力。

`openclaw plugins inspect <id>` 可查看某插件的形态与能力分解。

### 4.2 兼容性信号
`openclaw doctor` / `plugins inspect` / `status --all` / `plugins doctor` 会给出：`config valid`（正常）、`hook-only`（info，受支持但未迁移到能力注册）、`deprecated memory-embedding API`（warn）、`hard error`（配置非法或加载失败）。advisory/warn 不会破坏插件运行。

**外部兼容性立场**：能力注册是未来方向；基于 hook 的集成是外部插件最安全的“零破坏”过渡路径。所有 `openclaw/plugin-sdk/*` 都标注为 **experimental**，可能在版本间变化，插件作者需 pin 并测试所声明兼容的 host 版本。

---

## 5. 关键目录与职责

| 目录 | 边界/职责 | 关键文件 |
|------|-----------|----------|
| `src/plugins/**` | 插件**发现、清单校验、加载、注册表组装、契约执行、安装、依赖解析、hooks** | `types.ts`、`runtime/types.ts`、`contracts/registry.ts`、`public-surface-loader.ts`、`public-surface-runtime.ts`、`hooks.ts`、`install*.ts`、`discovery.ts`、`manifest-registry.ts`、`activation-planner.ts` |
| `src/plugin-sdk/**` | 插件与 core 的**公共契约边界**（第三方/捆绑插件同一边界） | `core.ts`、`plugin-entry.ts`、`provider-entry.ts`、`channel-contract.ts`、`feature-plugin.ts`、`feature-contract.ts`、`facade-loader.ts`、`facade-runtime.ts` |
| `extensions/**` | **捆绑插件（bundled plugins）**，共 165 个，是“第三方插件”的样板与边界验证 | 每个插件目录含 `openclaw.plugin.json`、`package.json`、`index.ts`/`channel.ts`、`api.ts`、`runtime-api.ts` 等 |
| `src/channels/**` | **核心渠道实现**（插件作者不得直接 import），对外经 SDK 暴露 | `plugins/types.plugin.ts`、`plugins/types.core.ts`、`plugins/types.adapters.ts` |

分层职责的两个关键点：
- `src/plugins` 内部也要**区分控制面与运行时面**：discovery / manifest 解析 / 配置校验 / setup 提示 / 激活规划属控制面；真正的插件执行属运行时解析。
- `src/plugin-sdk` 是**唯一允许扩张的公共边界**（含对外部调用者的扩张）；任何新 seam 都要同步更新 docs、`scripts/lib/plugin-sdk-entrypoints.json`、`package.json` exports、API diff/export 检查。

---

## 6. 插件清单：`openclaw.plugin.json` 与 `package.json`

### 6.1 清单的作用
每个原生 OpenClaw 插件**必须**在插件根目录放 `openclaw.plugin.json`。OpenClaw 读它来**在不执行插件代码的前提下**校验配置。清单缺失或非法会直接阻断配置校验，被当作插件错误。

清单用于（必须足够“廉价到无需启动运行时就能检视”）：
- 插件身份、配置校验、配置 UI 提示（`configSchema`、`configGroups`、`uiHints`）
- 鉴权/onboarding/setup 元数据（alias、auto-enable、provider 环境变量、`providerAuthChoices`）
- 控制面激活提示（`activation`）
- 根 CLI 命令名/描述/子命令标记（`cliCommands`）
- 模型族归属简写、静态能力归属快照（`contracts`）
- 面板 widget 数据绑定与动作动词、enabled 期间应存在的静态 MCP server（`mcpServers`）
- 可备份/可再生的状态资源（`backupResources`）、`qaRunners`、渠道配置（`channelConfigs`）

清单**不用于**：注册原生运行时 hook、声明完整运行时入口、npm 安装元数据——这些属于插件代码和 `package.json`。

### 6.2 字段分类（见 `docs/plugins/manifest/*` 子页）
- **模型**：`modelSupport` / `modelCatalog` / `modelIdNormalization` / `modelPricing`
- **供应商**：`imageGenerationProviderMetadata` 等生成元数据 / `mediaUnderstandingProviderMetadata` / `providerEndpoints` / `providerRequest`
- **Setup & Auth**：`setup`（含 `setup.providers`、`setup.nativeSessionCatalog`、字段表）/ `providerAuthChoices` / `providerUsageAuthEnvVars`
- **能力**：`contracts`（能力归属快照）/ `decisionModels` / `toolMetadata` / `activation`
- **宿主面**：图标 / `doctorContract` / `doctorHealthChecks` / `transcriptSources` / `backupResources` / `mcpServers` / `controlUi` / `dashboard` / `catalog` / `cliCommands` / `commandAliases` / `qaRunners` / `channelConfigs`
- **配置与密钥**：`configContracts`（含危险标记、SecretRef 迁移）/ `secretProviderIntegrations`

### 6.3 最小 vs 丰富示例

最小清单（`voice-call`）：
```json
{
  "id": "voice-call",
  "configSchema": { "type": "object", "additionalProperties": false, "properties": {} }
}
```

丰富清单（`openrouter`，provider 插件，节选）：
```json
{
  "id": "openrouter",
  "name": "OpenRouter",
  "providers": ["openrouter"],
  "modelSupport": { "modelPrefixes": ["router-"] },
  "modelIdNormalization": { "providers": { "openrouter": { "prefixWhenBare": "openrouter" } } },
  "providerEndpoints": [ { "endpointClass": "openrouter", "hostSuffixes": ["openrouter.ai"] } ],
  "providerRequest": { "providers": { "openrouter": { "family": "openrouter" } } },
  "cliBackends": ["openrouter-cli"],
  "setup": { "providers": [ /* ... */ ] }
}
```

### 6.4 清单 vs `package.json`
`package.json` 里有一个 `openclaw` 块承载**影响发现的运行时入口元数据**，例如：
```json
"openclaw": {
  "extensions": ["./index.ts"],      // 运行时入口
  "setupEntry": "./setup-entry.ts",  // 轻量 setup 入口
  "setupFeatures": { "configPromotion": true },
  "channel": { /* 渠道专属元数据：id/configuredState/approvalFlags/setup/commands */ },
  "compat": { "pluginApi": ">=2026.9.7" }  // 兼容的 host SDK 版本范围
}
```
区分原则：**“加载代码前就要读到的、且会执行代码才能确定的”运行时入口信息**放 `package.json#openclaw`；**纯声明式、校验用**的元数据放 `openclaw.plugin.json`。运行时 hook 注册则在插件代码里完成。

---

## 7. 插件入口与注册（Entry points & registration）

### 7.1 入口 helper
每个插件默认导出一个入口对象。SDK 为不同形态提供 helper（`docs/plugins/sdk-entrypoints.md`、`src/plugin-sdk/core.ts`、`plugin-entry.ts`）：

| Helper | 用途 |
|--------|------|
| `definePluginEntry(...)` | 通用插件（feature/tool/provider 皆可），核心是 `register(api)` 回调 |
| `defineToolPlugin(...)` | 工具插件（含工具策略/沙箱 bind 解析等） |
| `defineChannelPluginEntry(...)` | 渠道插件，内部封装 `api.registerChannel({ plugin })` |
| `defineSetupPluginEntry(...)` | 轻量 setup/onboarding 入口 |
| `defineBundledChannelEntry(...)` | 捆绑渠道专用：用 `specifier + exportName` 声明各子模块，**延迟加载**重模块 |
| `defineProviderEntry(...)` / provider 工厂 | 原生供应商工厂 |

`definePluginEntry` 的选项（`src/plugin-sdk/plugin-entry.ts`）大致为：
```ts
type DefinePluginEntryOptions = {
  id: string; name: string; description: string;
  kind?: "provider" | "tool" | "channel" | "feature";
  configSchema?: OpenClawPluginConfigSchema;
  reload?: ...;
  register: (api: OpenClawPluginApi) => void | Promise<void>;  // 核心回调
};
```

### 7.2 `OpenClawPluginApi`：注册与运行时的统一入口
`register(api)` 收到的 `api` 对象字段（`docs/plugins/sdk-overview.md`）：

| 字段 | 说明 |
|------|------|
| `api.id` / `api.name` / `api.version` / `api.description` | 插件身份 |
| `api.source` / `api.runtimeSource` / `api.rootDir` | 发现身份 vs 实际选中的运行时入口路径 |
| `api.config` | 当前配置快照（`OpenClawConfig`） |
| `api.pluginConfig` | 该插件的 `plugins.entries.<id>.config` |
| `api.runtime` | 运行时能力命名空间 `PluginRuntime`（见 §7.4） |
| `api.logger` | 作用域日志（debug/info/warn/error） |
| `api.registrationMode` | 当前加载模式 |
| `api.resolvePath(input)` | 相对插件根解析路径 |

注册方法分组（都挂在 `api` 上）：能力注册（provider/embedding/speech/媒体/生成/web…）、工具与命令（`registerTool`、自定义命令、node-host 命令、widget presenter）、基础设施（`registerHook`、`registerHttpRoute`、`registerGatewayMethods`、服务、迁移、SQLite/webhook helper）、宿主 hooks（会话扩展、受信工具策略、Control UI 描述符、运行时生命周期）、CLI 与发现、独占槽（上下文引擎/记忆）。

### 7.3 注册模式（Registration mode）
同一个 `register(api)` 会在不同阶段以不同模式被调用，插件据此决定做多少事：
- **`full`**：真正的运行时注册路径（跑业务）。
- **`setup-runtime`**：轻量 setup 流程，运行时**可用**但只做 setup/onboarding。
- **`cli-metadata`**：parse 时只注册 CLI 根命令名/描述等元数据，真正的 CLI 模块保持惰性，首次调用才注册。

渠道入口的典型分流（`src/plugin-sdk/core.ts` 的 `defineChannelPluginEntry`）：
```ts
register(api) {
  if (api.registrationMode === "cli-metadata") { registerCliMetadata?.(api); return; }
  api.registerChannel({ plugin });   // 核心注册
  setRuntime?.(api.runtime);
  // ... full 模式下再注册完整能力
}
```

### 7.4 `PluginRuntime`（`api.runtime`）
运行时能力命名空间（`src/plugins/runtime/types.ts`），把“可能跨调用者/跨 turn 存活”的宿主能力以**闭包绑定**的方式交给插件：
```ts
type PluginRuntime = PluginRuntimeCore & {
  gateway: {
    isAvailable(): Promise<boolean>;
    request<T>(method, params?): Promise<T>;
    readSessionFacts(...): Promise<...>;
    subscribeSessionChanges(listener): () => void;
  };
  subagent: { complete(...): Promise<{text}>; run(...): Promise<SubagentRunResult>; };
  nodes:    { list(...): Promise<...>; invoke(...): Promise<unknown>; };
  channel:  PluginRuntimeChannel;
  // 另有 sandbox / worktrees / state store 等
};
```
**关键安全约束**：所有暴露给插件的工具/preparer/回调/审批/原生动作都必须**闭包绑定（closure-bound）**；一旦 owner 关闭或能力闭合（包括在 await 策略工作期间闭合），插件保留的副本必须失效。插件**不得**在内部重建宿主权限。可跨越发起者/turn 存活的工作必须用**活跃的、服务拥有的能力**，并在副作用边界重新校验服务代际（generation）。

---

## 8. 加载与激活流水线（Load pipeline）

从磁盘上的插件目录到真正跑业务，大致经过六步（源码在 `src/plugins/*`、`src/plugin-sdk/facade-*`）：

```
① Discovery 发现
   discovery.ts：扫描 bundled / workspace / global / package 四类根
   读 openclaw.plugin.json（原生）或兼容 bundle 清单
   → PluginDiscoveryResult { candidates, diagnostics }
            │
            ▼
② Manifest Registry 清单注册表
   manifest-registry.ts：从安装记录 + 候选组装 PluginManifestRecord[]
   缓存元数据，派生 channelIds / providers / cliBackends 等索引
   → PluginManifestRegistry
            │
            ▼
③ Activation Planning 激活规划（控制面，纯元数据，不 import 运行时）
   activation-planner.ts：按触发器(command/provider/channel/capability)
   计算需激活的插件集合并传播依赖
   → PluginActivationPlan { pluginIds, entries, diagnostics }
            │
            ▼
④ Runtime Loading 运行时加载（惰性）
   public-surface-loader.ts + facade-loader.ts：按记录的入口点解析模块位置
   public-surface-runtime.ts：在插件内解析 .js/.mjs/.ts 等并做路径安全校验
   → 同步加载入口模块
            │
            ▼
⑤ Registration 注册
   plugin.register(api)：按 registrationMode 调用 api.registerXxx()
   → 能力写入 active-runtime-registry（中央注册表）
            │
            ▼
⑥ Surface Consumption 面消费
   Gateway / agent 工具 / Control UI 读注册表，暴露工具/渠道/供应商设置/
   hooks/HTTP 路由/CLI/服务；hooks.ts 在相应时机触发钩子
```

### 8.1 元数据快照：`PluginCache` / `PluginMetadataSnapshot` / `PluginLookUpTable`
- 首次访问插件元数据（含 Gateway 启动前的 CLI preflight）时启动**一个** `PluginCache`，按需渐进填充。
- Gateway 启动时持有该 cache 并构建**不可变**的 `PluginMetadataSnapshot`：含所有已配置 workspace 的插件元数据（含禁用插件）、安装索引、清单注册表、诊断、owner 映射、id 归一器，并保留源优先级与 workspace 来源。
- `PluginLookUpTable` 由同一快照派生，叠加当前运行配置的启动插件计划。
- 启动后，运行时读者**复用**该清单，不再做文件系统发现/清单重读/新鲜度检查。只有显式插件生命周期操作（安装/更新/移除/源或清单编辑/发现根变化）才准备新清单并发布给运行中的 Gateway。
- 规则：**Gateway 只保留一个 cache 代际；显式管理操作使用同一 cache 的隔离代际；Gateway 元数据没有 wall-clock TTL。**

### 8.2 Facade 与惰性加载机制
核心手段是 `src/plugin-sdk/facade-loader.ts` 的 `createLazyFacadeObjectValue()`：返回一个 **Proxy**，只有在真正访问属性时才 `load()` 实际模块，并在解析时检查该插件当前是否仍处于 `loaded` 状态——如果插件已被禁用/卸载，访问即抛错。这样：
- 启动只需 `.json` 清单，无需 import 插件代码；
- setup/onboarding 可在不执行插件的情况下工作；
- 支持热重载与禁用，惰性边界得以保留。

`resolveBundledPublicSurfaceLocation()` 则负责定位捆绑插件的 facade 模块：先查运行时覆盖 → 查 bundled plugins 目录 → 命中进程稳定缓存 → 解析 bundled facade 位置 → 回填缓存。

### 8.3 light vs heavy：`api.ts` 与 `runtime-api.ts`
插件内部按“冷/热路径”拆分导出，避免热路径入口（渠道启动）把重运行时拖进来：
- **`api.ts`（light）**：只导出必要的公共契约/静态数据（如渠道的 plugin 对象、config schema helper、account/config helper）。业务逻辑类（如发送、流式）仍是私有。
- **`runtime-api.ts`（heavy）**：导出重运行时工具链（流处理、embedding provider、stream 包装等），按需（send/monitor/probe/login/setup 等异步路径）才加载。
- 渠道还可用更细的 `channel-api.ts`、`*.runtime.ts`、`*.runtime-api.ts` 把重代码挡在热路径之外。
- 当 core 的热路径需要插件自带静态数据时，暴露轻量顶层 artifact（如 `gateway-auth-api.ts`、`message-tool-api.ts`），并与完整插件复用同一本地 helper，防止快/慢路径漂移。

---

## 9. 插件分类与各自契约

| 分类 | 入口/注册方式 | 核心契约来源 | 职责 |
|------|---------------|--------------|------|
| **Channel 渠道** | `defineChannelPluginEntry` / `defineBundledChannelEntry`，内部 `api.registerChannel` | `src/plugin-sdk/channel-contract.ts`、`src/channels/plugins/types.*.ts` | 消息收发、账户绑定、线程/会话、传输、配对、allowlist、命令门控、onboarding |
| **Provider 供应商** | `definePluginEntry` + `api.registerProvider`（及 speech/embedding/生成等） | `src/plugin-sdk/provider-entry.ts`、清单 `providers`/`modelCatalog`/`providerAuthChoices` | 模型目录、鉴权、API 调用、流式、补全/嵌入 |
| **Tool 工具** | `defineToolPlugin` 或 `register()` 内 `api.registerTool` | `src/plugins/types.ts`、工具策略/沙箱 | 执行具体工具（含工具策略/沙箱 bind） |
| **Feature/Hook 特性** | `definePluginEntry` + `register()` 注册 hooks/命令/服务/路由 | `src/plugin-sdk/feature-plugin.ts`、`feature-contract.ts` | 通用能力：生命周期 hook、HTTP 路由、Gateway 方法、后台服务 |
| **独占能力** | 上下文引擎 / 记忆：`register*`（同时只一个生效） | `sdk-overview/memory-and-context` | 上下文工程、记忆/嵌入适配 |
| **其它** | CLI 后端 `registerCliBackend`；agent harness；`registerGatewayDiscoveryService`；`registerMigrationProvider`；Code Mode executor（`contracts.codeModeExecutors` + `code-mode-executor-api`） | 对应 SDK 子路径 | 本地 AI CLI 后端 / 原生 agent 执行器 / 服务发现 / 迁移 / QuickJS 执行器 |

渠道边界补充（`src/channels/AGENTS.md`）：`channel.ts`、`shared.ts`、`channel.setup.ts`、`gateway.ts`、`outbound.ts` 都是**热 import 路径**，不得静态拉入 send/monitor/probe/directory-live/setup 等异步面；共享渠道改动会同时影响内置与扩展渠道，需覆盖路由/配对/allowlist/命令门控/onboarding/回复行为。

---

## 10. 典型实例剖析

### 10.1 Telegram（Channel 典范）—— `extensions/telegram/`
- **清单**：`categories:["channels"]`、`channels:["telegram"]`、`doctorContract`（配置修复 + 状态迁移）、`activation.onStartup:false`。
- **`package.json#openclaw.channel`**：声明 `id/label`、`configuredState.env`（如 `TELEGRAM_BOT_TOKEN`）、`approvalFlags`、`setup.fields`（token / tokenFile(敏感) / useEnv）、`commands.nativeCommandsAutoEnabled` 等——**全是声明式元数据**。
- **入口 `index.ts`**：用 `defineBundledChannelEntry`，以 `{ specifier, exportName }` 声明 `plugin`、`secrets`、`runtime`、`accountInspect` 等子模块，全部**惰性加载**；`registerFull` 挂 mini-app 注册。
- **light/heavy**：`api.ts` 只导出 plugin/setup/config helper；`runtime-api.ts` 导出 send/override、config schema 构造等重模块。渠道自带 drain 契约、队列、media 处理，并在最终发送前 pin 住已解析的 bot 凭据（见 §11）。

### 10.2 Ollama（Provider 典范）—— `extensions/ollama/`
- **清单驱动一切供应商元数据**：`categories:["models"]`、`activation.onStartup:true`、`enabledByDefault:true`、`providers:["ollama","ollama-cloud"]`、`providerCatalogEntry`、`providerRequest.providers.*.family`、`modelCatalog.discovery`（refreshable）、`modelPricing`（本地 external:false / 云 external:true）、`providerAuthChoices`（local / api-key）、`contracts`（embeddingProviders / tools:["node_inference"] / webSearchProviders）。
- **`package.json` 极简**：`openclaw.extensions:["./index.ts"]` + 少量运行时依赖；SDK 作为 devDependency（`workspace:*`）。
- **发现 `provider-discovery.ts`**：导出 `{ id, label, docsPath, envVars, auth, resolveSyntheticAuth, run }`，其中 `resolveSyntheticAuth` 为本地场景合成默认 key。
- **light/heavy**：`api.ts` 导出模型定义/枚举 helper；`runtime-api.ts` 导出 `createOllamaStreamFn`、`resolveOllamaBaseUrlForRun` 等流式运行时。

### 10.3 Geolocation（Feature 典范）—— `extensions/geolocation/`
- **清单**：`categories:["infrastructure"]`、`enabledByDefault:true`、`activation.onStartup:true`、带 `configSchema`/`configGroups`/`uiHints`（纯配置驱动）。
- **入口 `index.ts`**：直接 `definePluginEntry({ id, name, register(api){...} })`。在 `register` 内：读 `api.pluginConfig` → 建数据库 store 与 lookup → `registerGeolocationGatewayMethods(api, lookup)` → `api.registerHttpRoute({ path:"/plugins/geolocation", auth:"gateway", match:"prefix", handler })`。
- **特征**：功能简单的 feature 插件无需拆 `api.ts`/`runtime-api.ts`，一个 `register()` 钩子即可。

### 10.4 OpenShell（Tool/Sandbox 类）—— `extensions/openshell/`
- 以 `src/` 下的 backend/config/cli/mirror/fs-bridge 等模块组织工具与沙箱执行，入口 `index.ts` 注册工具能力。体现“非能力插件”（注册工具/服务但不注册 capability）的组织方式。

> 对照可见：**渠道/供应商**把大量元数据放清单、运行时严格拆分 light/heavy；**feature/tool**可以更轻量。但所有插件都遵循同一边界：只 import `openclaw/plugin-sdk/*` 和本地 barrel。

---

## 11. 生命周期与运行时治理

这是 OpenClaw 插件系统最“重”的部分，核心目标是：**元数据稳定、运行时惰性、热替换安全、失败隔离、更新永远可用**（`docs/plugins/architecture.md`）。

### 11.1 安装（Install）
`src/plugins/install*.ts` 提供从本地目录 / npm pack 归档 / npm spec / 任意归档或路径安装。流程大致：下载/解包到临时目录 → 校验 `openclaw.plugin.json` → 计算完整性/来源（provenance）→ 安全扫描 → 落到插件安装目录 → 写安装记录（config 的 `plugins.entries.<id>`）→ 由 Gateway 生命周期 owner 准备并发布新清单。**运行时从不安装依赖**；install/update/doctor 才是修复点。

### 11.2 热替换 / 重载（Reload / Replacement）
- 启动与热替换共享**同一个** registry publisher 与同一份 inventory；替换前先校验候选元数据，再 drain 受影响的服务与渠道。
- **等价元数据的键重排不触发替换**；值变化、有序列表变化、显式 reload 请求才触发。
- 替换先停旧注册再注册新的，然后**一起**发布运行时方法与元数据；连接的客户端随后刷新能力。
- **Drain 预算**：保留工作与在途调用共享 60 秒 pre-stop 预算；已准入的 run 用原回调跑完，新顶层工作拿不到旧实例。失败则 reload 失败一次、恢复准入、清空 reload 状态，旧代际继续服务。
- 可用 `openclaw plugins reload <id>`（`--wait` 等待准入工作结算；Ctrl+C/断连取消 pre-publication 等待并回滚，但**不**丢弃已准入工作）。

### 11.3 失败隔离与恢复（Recovery）
- provider/harness 插件加载失败只记录在其运行时代际里，使该插件不可用，但**不**顶替代际、不阻塞用健康插件的模型。
- 发布前失败：自动尝试恢复旧代码与配置（有独立的 Gateway 持有取消信号，断连的请求者无法打断恢复）。
- 发布后失败：尝试针对已提交配置重发布模型目录与回复调度；原插件失败仍可见。
- 恢复**从不**把当前包文件塞给一个已退休、其捕获源已释放的注册；缺失的捕获源只产生警告而非阻断全新加载。

### 11.4 渠道的“最终发送”握手
不相关的 reload 后，持久化的最终渠道回复**仅当其精确渠道注册被保留**（且渠道设置、共享默认、owner 设置均未变）时，才可用当时 Gateway 的注册发送。渠道可加“发送者准备”：如 **Telegram 会检查并 pin 住解析出的 bot 凭据**用于最终发送，使 token 文件内容/环境 token/SecretRef 的变化都无法切到另一个 bot。该路径**从不**回退到另一个 Gateway，也不重试可能已达供应商的发送。

### 11.5 运行时实例与源生命期
- 推理验证会对运行时按 source/build 偏好选中的 artifact 做指纹；加载未变插件保留该证明，改变选中的运行时文件则失效。
- 托管运行时实例拥有自己的模块结果、注册的 callable、runtime-store 槽；非捆绑实例还拥有捕获的源 artifact。捆绑运行时/ setup 模块共享 host 代码身份；**加载编辑过的捆绑代码需重启 Gateway**（编译输出需先 rebuild）。
- 原生 artifact 连同其所属包目录一起准入，保留二进制的包相对路径与声明的伴随库依赖；托管 npm 插件支持在另一文件系统/ tmpfs/ 符号链接 npm 根上存捕获。

---

## 12. 安全与信任模型

- **公共边界即信任边界**：插件只经 `openclaw/plugin-sdk/*` 与 host 交互；不得深入 core 内部或别的插件私有文件。bundled 与第三方同一边界，无私有后门。
- **能力闭包绑定**：所有暴露给插件的工具/preparer/回调/审批/原生动作在 owner 关闭后必失效；特权动作在 await 工作后、副作用前**重新校验当前 owner 持有的权限**——token/签名/过期/ID 匹配都不足以证明“活的权限”。
- **值边界**：加载即准入一次；之后按引用传值，插件交出后不得再改。
- **机密处理**：清单声明 `configContracts`/`secretProviderIntegrations`，运行时用 SecretRef 语义；凭据/私有数据不得进入提交、日志、transcript、媒体。
- **原生 UI 的额外闸门**：用户安装插件的原生 Control UI 需要默认关闭的「Custom plugin UI lab」；后端插件 API 与普通加载不需要。
- **Code Mode 执行器**：缺失或禁用的执行器显式失败，host **绝不**降级到隔离更弱的执行器。
- **安全是产品权衡**：在具体风险与用户成本/锁定/能力损失间权衡，优先“最不限制但有效”的保护；风险路径保持显式、operator 可控，且在既有信任模型与审批边界内。

---

## 13. 生态全景（`extensions/` 下 165 个捆绑插件）

> 以下按主要职责归类（部分插件跨类）。类别命名对应清单 `categories`。

- **Channel（渠道，~19）**：discord, facetime, feishu, googlechat, google-meet, imessage, irc, line, matrix, mattermost, msteams, nextcloud-talk, nostr, signal, slack, synology-chat, telegram, tlon, twitch, whatsapp, zalo
- **Provider（模型/推理，~70+）**
  - 云 API：openai, anthropic, anthropic-vertex, google, cohere, mistral, meta, xai, perplexity, groq, deepseek, together, openrouter, vercel-ai-gateway, amazon-bedrock(-mantle), microsoft(-foundry), azure-speech
  - 平台/聚合：litellm, baseten, replicate(见社区), huggingface, deepinfra, novita, featherless, beam, cloudflare(-ai-gateway), gmi, venice, arcee, synthetic
  - 中文/区域：qwen, qianfan, moonshot, minimax, stepfun, tencent, alibaba, byteplus, volcengine, kimi-coding, zai, zalouser, xiaomi, longcat
  - 本地推理：ollama, vllm, llama-cpp, lmstudio, onnx, nvidia, sglang, gradium, cerebras, apple-fm
  - 语音/音视频/图像：elevenlabs, deepgram, inworld, fish-audio-speech, senseaudio, fal, runway, pixverse, comfy, image-generation-core, voyage
  - CLI 后端/编码：codex, copilot(-proxy), github-copilot, opencode(-go), kilocode
- **Tool / Feature / 基础设施（~60+）**：
  - Web/搜索：brave, duckduckgo, exa, firecrawl, tavily, searxng, web-readability, browser
  - 记忆/文档/知识：active-memory, memory-core, memory-lancedb, memory-wiki, document-extract
  - 计算/代码执行：code-mode-quickjs, llm-task, canvas, diffs(-language-pack)
  - 系统/设备/网络：geolocation, openshell, vault, onepassword, device-pair, linux-node, crabbox, bonjour, file-transfer, admin-http-rpc, imap, mxc, radius, reef, oc-path
  - 协作/工作流：workboard, session-share, team-reports, logbook, slack-huddles, teams-meetings, zoom-meetings, voice-call, talk-voice, tts-local-cli, sms, buzz, clickclack, kie, lobster, raft, parallel, vydra, tokenjuice
  - 迁移：migrate-claude, migrate-hermes
- **其它/系统类**：路由与网关 clawrouter, agentsapi, a2a；配置/策略 policy, typesafe；可观测与测试 diagnostics-otel, diagnostics-prometheus, qa-lab, qa-channel, test-support, visitor-access；计算机使用 cua-computer, acpx, github

> 完整清单由 `pnpm plugins:inventory:gen` 生成到 `docs/plugins/plugin-inventory.md`（生成物，勿手改）。

---

## 14. 参考文件清单（便于逐条核对）

**设计约束（AGENTS.md）**
- 根 `AGENTS.md` —— Design priorities / One owner / Small core / 能力阶梯入口
- `src/plugin-sdk/AGENTS.md` —— SDK 边界规则、Versioned Required Capabilities、能力阶梯全文
- `src/plugins/AGENTS.md` —— loader 边界、控制面/运行时面分离、可用性与选择
- `extensions/AGENTS.md` —— 捆绑插件边界（= 第三方边界）
- `src/channels/AGENTS.md` —— 渠道热路径与惰性 seam

**权威文档（docs/plugins/）**
- `architecture.md` —— 能力模型、四层架构、元数据快照、热重载与恢复、运行时/源生命期（最核心）
- `sdk-overview.md`（及 `sdk-overview/*`）—— 注册 API、子路径目录、`OpenClawPluginApi` 字段
- `sdk-entrypoints.md`（及 `sdk-entrypoints/*`）—— `defineToolPlugin`/`definePluginEntry`/`defineChannelPluginEntry`/`defineSetupPluginEntry`、注册模式、Code Mode executor、MCP/工作区运行时
- `manifest.md`（及 `manifest/*`）—— `openclaw.plugin.json` 全字段、与 `package.json` 的分工
- `sdk-runtime.md`（及 `sdk-runtime/*`）—— `api.runtime` 命名空间、值边界
- `sdk-channel-plugins.md` / `sdk-provider-plugins.md` —— 渠道/供应商插件专题
- `building-plugins.md` / `tool-plugins.md` / `feature-plugins.md` / `hooks/*` —— 构建指南与 hooks
- `compatibility.md` / `dependency-resolution.md` / `bundles.md` —— 兼容窗口、依赖解析、兼容 bundle 格式

**关键源码**
- 加载器：`src/plugins/discovery.ts`、`manifest-registry.ts`、`activation-planner.ts`、`public-surface-loader.ts`、`public-surface-runtime.ts`、`hooks.ts`、`install*.ts`、`runtime/types.ts`、`contracts/registry.ts`、`active-runtime-registry.ts`
- SDK：`src/plugin-sdk/core.ts`、`plugin-entry.ts`、`provider-entry.ts`、`channel-contract.ts`、`feature-plugin.ts`、`feature-contract.ts`、`facade-loader.ts`、`facade-runtime.ts`、`facade-resolution-shared.ts`
- 实例：`extensions/telegram/`（channel）、`extensions/ollama/`（provider）、`extensions/geolocation/`（feature）、`extensions/openshell/`（tool/sandbox）

**自助检视命令**
- `openclaw plugins inspect <id>`（含 `--runtime --json`）—— 查看形态/能力/运行时状态
- `openclaw doctor` / `openclaw plugins doctor` / `openclaw status --all` —— 兼容性信号
- `openclaw plugins reload <id> [--wait]` —— 热重载
- `pnpm plugins:inventory:gen` —— 重新生成插件清单文档

---

## 15. 小结：这套设计想达成什么

1. **用清单换启动速度**：绝大多数决策（渠道归属、启动计划、供应商/CLI 后端归属、schema 校验、auto-enable）都在不执行插件代码的前提下、靠一份不可变快照完成。
2. **用 facade/惰性换上下文与内存**：热路径只碰 light artifact，重运行时按需加载，禁用即失效。
3. **用“一个 owner + 窄契约”换可维护性**：core 保持小，供应商/渠道/工具的差异都被各自插件吸收，共享行为抽成命名的 family helper 而非到处复制。
4. **用闭包绑定 + 代际校验换安全**：能力随 owner 生命周期失效，特权动作在副作用前复验活权限。
5. **用严格的替换/ drain/ 恢复协议换“更新永远可用”**：热重载安全、失败隔离、旧代际兜底、渠道最终发送可确定地握手。

一句话：**core 定义“通用契约与治理”，插件提供“具体能力”，清单与 SDK 是两者之间稳定、惰性、可演进的契约层。**











