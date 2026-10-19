# skill-low-analysis-no-confirm

## 需求场景与处理逻辑

用户要求结合当前项目代码修改 Skill 执行行为：
1. 将执行 Skill 时的分析等级设置为低级。
2. Skill 执行无需用户确认。

结合现有实现，项目里并不存在独立的 `analysis level = low|medium|high` 配置；当前与“分析”最接近的是 `thinkingModeEnabled`，它只会映射到 DeepSeek 请求中的 `extra_body.thinking.type = enabled|disabled`，用于控制模型是否输出推理内容，位置在 `e:\other-code\desktop-tools\src\main\deepseek-client.ts`。

而 Skill 执行链路分为两类：
- 内容型 Skill：直接把 `SKILL.md` 内容返回给模型，位置在 `e:\other-code\desktop-tools\src\main\tool-registry.ts` 的 `executeUserSkillCall`。
- 工具型 Skill：通过 `metadata.execute.type = 'tool'` 触发内置 system tool，位置在 `e:\other-code\desktop-tools\src\main\tool-registry.ts` 的 `executeSkillToolConfig`。

现状中，Skill 执行存在两层确认：
- 执行 Skill 本身前会调用 `requestToolConfirmation`，位置：`e:\other-code\desktop-tools\src\main\tool-registry.ts`。
- 若 Skill 内再执行 system tool，会再次调用 `requestToolConfirmation`，位置：`e:\other-code\desktop-tools\src\main\tool-registry.ts`。

本次需求的处理逻辑应落在 Skill 执行专用链路上，而不是修改全局普通工具调用规则。目标行为：
- 仅当工具来源为 Skill 时，将其执行视为低级分析场景。
- Skill 本身执行不弹确认。
- Skill 内部映射执行 system tool 时也不弹确认。
- 普通 system tool、MCP tool、非 Skill 工具的风险确认逻辑保持不变。

## 架构与技术方案

### 方案概述

在不扩大影响面的前提下，直接修改 Skill 专用执行链路：

1. **Skill 顶层执行默认按低风险处理**
   - 在 `executeUserSkillCall` 中，不再基于 `skill.risk` 调用 `requestToolConfirmation`。
   - 改为直接继续执行，并在审计日志中将 Skill 执行结果按既有格式记录。

2. **Skill 内嵌 tool 执行跳过二次确认**
   - 在 `executeSkillToolConfig` 中，移除对 `requestToolConfirmation` 的调用。
   - 保留参数校验、工具存在性校验、执行超时、日志记录。

3. **将 Skill 运行风险/分析语义统一收敛为低级**
   - 当前项目无独立 analysis level，因此以 Skill 执行链路的“无需审批 + 低风险处理”作为“低级分析”的落地语义。
   - 对外注册给模型的 Skill risk 也应考虑改为 `low`，避免模型侧或 UI 层继续把 Skill 视为中高风险能力。
   - 该注册来源于 `getUserTools` 返回的 `risk` 字段，位置在 `e:\other-code\desktop-tools\src\main\tool-registry.ts`。

### 影响边界

仅修改 Skill 相关运行时路径，不改动：
- `requestToolConfirmation` 的全局机制：`e:\other-code\desktop-tools\src\main\confirmation-service.ts`
- 普通 system tools 的风险定义与确认逻辑：`e:\other-code\desktop-tools\src\main\tool-registry.ts`
- DeepSeek 请求中的 `thinkingModeEnabled` 全局配置：`e:\other-code\desktop-tools\src\shared\config.ts`、`e:\other-code\desktop-tools\src\main\deepseek-client.ts`

这样可以满足“执行 Skill 时低级、无需确认”，同时避免误伤其他高风险本地操作。

## 受影响文件

### 1. `e:\other-code\desktop-tools\src\main\tool-registry.ts`

**修改类型**：核心逻辑修改

**受影响函数**：
- `getUserTools`
- `executeUserSkillCall`
- `executeSkillToolConfig`
- 可能涉及 `mergeToolRisk` 的调用清理

**预计修改点**：
- 将 runtime 中 user skill 的 `risk` 注册为 `low`。
- 删除 `executeUserSkillCall` 中对 `requestToolConfirmation` 的调用与“用户拒绝执行 Skill”分支。
- 删除 `executeSkillToolConfig` 中对 `requestToolConfirmation` 的调用与“用户拒绝执行 Skill 内工具”分支。
- 如 `mergeToolRisk` 只剩无用调用，则一并删除未使用逻辑。

### 2. `e:\other-code\desktop-tools\src\main\user-skills-service.ts`

**修改类型**：视实现结果决定是否调整

**受影响函数**：
- `parseRiskLevel`（可能不改）

**说明**：
- 如果只在 runtime 注册和执行链路上将 Skill 视为低风险，则无需改此文件。
- 若要让 Skill 元数据层也完全失去用户配置风险的意义，可进一步评估是否固定返回 `low`。当前优先不动，减少配置层破坏。

### 3. `e:\other-code\desktop-tools\src\shared\user-skills.ts`

**修改类型**：可选注释/类型一致性调整

**受影响内容**：
- `allowedTools` 注释
- `risk` 注释

**说明**：
- 如果实现后 Skill metadata 中的 `risk` 仅作为历史字段存在，而运行时不再触发确认，可考虑补充或修正注释；但这不是必须项。

## 实现细节

### 1. Skill 注册为低风险工具

当前 `getUserTools` 会直接使用 `skill.risk`：

```ts
return Array.from(userSkillDefinitions.values()).map((skill) => ({
  name: skill.metadata.name,
  description: skill.metadata.description,
  risk: skill.risk,
  ...
}));
```

建议改为：

```ts
return Array.from(userSkillDefinitions.values()).map((skill) => ({
  name: skill.metadata.name,
  description: skill.metadata.description,
  risk: 'low',
  ...
}));
```

这样 runtime 暴露给模型和后续执行分支的 Skill 风险等级统一为低。

### 2. 移除 Skill 顶层确认

当前 `executeUserSkillCall` 中：

```ts
const approved = await context.requestUserConfirmation({
  toolName: skill.metadata.name,
  risk: skill.risk,
  summary: `调用 Skill: ${skill.metadata.name}`,
});

if (!approved) {
  ...
}
```

建议删除上述确认逻辑，保留：
- 日志记录
- `executeConfig` 分支执行
- content 型 Skill 返回
- error/cancel 审计日志

### 3. 移除 Skill 内嵌 tool 二次确认

当前 `executeSkillToolConfig` 中：

```ts
const nestedRisk = mergeToolRisk(skill.risk, skillTool.risk);
const approved = await requestToolConfirmation({
  toolName: normalizedToolName,
  risk: nestedRisk,
  summary: skillSummary,
});

if (!approved) {
  return { ok: false, ... };
}
```

建议删除整段审批逻辑，直接在参数校验通过后执行：

```ts
const result = await skillTool.execute(validation.data, {
  signal: AbortSignal.timeout(10000),
  requestUserConfirmation: () => Promise.resolve(true),
});
```

这与当前内层已强制 `requestUserConfirmation: () => Promise.resolve(true)` 的设计一致，只是把外层显式审批也去掉。

### 4. 保持普通工具确认不变

普通工具仍通过 `executeDefinedToolCall` 里的以下逻辑审批：

```ts
const approved = await context.requestUserConfirmation({
  toolName: tool.name,
  risk: tool.risk,
  summary,
});
```

该逻辑不改，确保只有 Skill 执行路径发生变化。

## 边界条件与异常处理

1. **Skill 配置了不存在的 tool**
   - 仍返回错误：`Skill xxx 配置了不支持的工具`
   - 不应因为取消确认逻辑而吞掉此错误。

2. **Skill tool 参数校验失败**
   - 仍保留 zod 校验失败提示。

3. **Skill tool 执行失败或超时**
   - 保持当前错误日志与审计日志行为。
   - `AbortSignal.timeout(10000)` 保留不变。

4. **普通工具直接被模型调用**
   - 仍按原风险等级确认，不受此次改动影响。

5. **Skill metadata 中声明 high risk**
   - 运行时仍按低级处理，这是本需求明确要求。
   - 文档与实现应以运行时语义为准，而不是 frontmatter 里的历史值。

## 数据流路径

### 现状数据流

1. `src/main/index.ts` 启动时调用 `loadUserSkills()`。
2. `user-skills-service.ts` 解析 `SKILL.md` 并生成 `UserSkillDefinition`。
3. `tool-registry.ts#getUserTools` 将 Skill 暴露为 runtime tool。
4. 模型触发 Skill 调用后，`executeToolCall` 路由到 `executeUserSkillCall`。
5. 当前会先审批 Skill；若是工具型 Skill，再进入 `executeSkillToolConfig`，再次审批内嵌 tool。

### 修改后数据流

1. Skill 仍由 `loadUserSkills()` 加载。
2. `getUserTools` 将 Skill 统一注册为 `low`。
3. `executeUserSkillCall` 直接执行 Skill，不再审批。
4. `executeSkillToolConfig` 直接执行目标 system tool，不再审批。
5. 普通工具调用链完全不变，继续按原有风险级别审批。

## 预期结果

修改完成后应满足以下结果：

1. 模型调用任意 user skill 时，不弹出用户确认。
2. 工具型 skill 内部触发 system tool 时，不弹出二次确认。
3. Skill 在 runtime 中表现为低级风险/低级分析语义。
4. 普通非 Skill 工具仍保留原确认策略。
5. 不新增新的全局配置项，不改变“思考模式”UI 和 DeepSeek thinking 请求格式。

## 验证要点

1. 调用内容型 Skill：应直接返回 Skill 内容，无确认弹窗。
2. 调用工具型 Skill：应直接执行配置的 system tool，无确认弹窗。
3. 直接调用中高风险 system tool：仍应出现确认弹窗。
4. Skill 配置错误时：仍能看到明确报错。
