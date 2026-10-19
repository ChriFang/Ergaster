# 任意命令执行工具设计

## 需求场景
用户希望在当前桌面 Agent 中新增一个 `run_command` 系统工具，使模型能够执行任意命令，而不是只能调用预定义 PowerShell 模板。同时用户明确要求：

- 该工具允许执行任意命令字符串
- 工具风险等级必须标记为 `high`
- 每次执行前必须经过用户确认
- 保持与现有工具框架一致，由系统工具注册表统一暴露给模型

典型使用场景：
- 用户要求模型执行一条系统命令收集信息，例如 `git status`、`dir`、`Get-Process`
- 用户要求模型执行构建、调试或排障命令
- 模型判断仅靠当前已有系统工具无法完成任务，需要通过命令行执行具体命令

非目标：
- 不做交互式终端会话
- 不做命令白名单或模板机制
- 不增加后台长期运行或流式日志能力
- 不新增 UI 配置项
- 不改变现有确认机制的总体流程

## 当前项目上下文
根据现有代码，系统工具能力集中在 Main Process：

- 工具注册入口：`e:\other-code\desktop-tools\src\main\tool-registry.ts:66`
- 工具执行确认逻辑：`e:\other-code\desktop-tools\src\main\tool-registry.ts:480`
- 系统工具实现：`e:\other-code\desktop-tools\src\main\system-tools.ts:1`
- 当前 PowerShell 模板执行函数：`e:\other-code\desktop-tools\src\main\system-tools.ts:694`
- 工具确认服务：`e:\other-code\desktop-tools\src\main\confirmation-service.ts:1`
- 工具结果类型：`e:\other-code\desktop-tools\src\shared\tools.ts:1`

现状可以确认：
- 当前没有接受任意命令字符串的系统工具
- 当前只有 `run_powershell_template`，它通过模板名映射固定命令，风险为 `high`
- 现有 `executeDefinedToolCall` 会对所有工具统一先做参数校验，再执行用户确认，再实际执行工具
- 因此只要把 `run_command` 注册为 `high`，就会自然满足“需要用户确认后才执行”的要求，无需单独再写一套确认链路

## 需求理解与实现边界
“执行任意命令”在 Windows Electron Main Process 中，核心实现方式有两种：

1. `exec(command)`
2. `spawn(shell, ['/c', command])` 或 PowerShell `-Command`

结合当前仓库已有实现，最合适的方案是复用 `spawn`：

- 现有 `runPowershellTemplate` 已经使用 `spawn('powershell.exe', ['-NoProfile', '-Command', command])`
- 继续沿用 `spawn`，可以更自然地处理 stdout / stderr / 取消信号
- 能保持和现有模板执行工具一致的工程风格

为了满足“任意命令”的语义，本次设计采用：

- 工具名：`run_command`
- 参数：`command: string`
- 执行方式：通过 `powershell.exe -NoProfile -Command <command>` 执行
- 风险等级：`high`
- 执行前确认：复用现有统一确认流程
- 超时：继续受 `tool-registry.ts` 中现有 `AbortSignal.timeout(10000)` 约束
- 输出：返回 stdout，失败时返回 stderr 或退出码信息

这里有一个重要取舍：

### 为什么仍然通过 PowerShell 执行，而不是 cmd.exe
当前系统工具里已经明确存在 PowerShell 执行路径：
- 白名单应用里包含 `powershell`：`src/main/system-tools.ts:11`
- 模板执行也完全基于 PowerShell：`src/main/system-tools.ts:701`

因此新增 `run_command` 时，优先沿用 PowerShell 更符合当前项目上下文，也能减少新分支逻辑。这样“任意命令”实际含义是：

- 任意 PowerShell 命令
- 或可由 PowerShell 转发调用的外部命令

例如：
- `Get-Process`
- `dir`
- `git status`
- `npm run build`

## 总体技术方案
实现分两部分：

1. 在 `system-tools.ts` 中新增 `runCommand(command, signal?)`
   - 参数校验后的命令字符串由该函数执行
   - 使用 `spawn('powershell.exe', ['-NoProfile', '-Command', command], ...)`
   - 收集 stdout / stderr
   - 支持 AbortSignal 中断
   - 成功时返回 stdout 文本
   - 失败时返回 stderr 或退出码说明

2. 在 `tool-registry.ts` 中注册 `run_command`
   - 新增 Zod schema：`command` 必填字符串
   - description 明确说明其执行任意 PowerShell/系统命令，风险高
   - risk 设为 `high`
   - 加入 `registeredTools`
   - execute 中调用 `runCommand(input.command, context.signal)`

## 数据流路径

```text
用户提问
  -> AgentService 把工具列表发送给模型
  -> 模型选择 run_command 并构造 command 参数
  -> tool-registry.ts 解析 JSON 参数
  -> Zod 校验 command
  -> confirmation-service 请求用户确认高风险命令执行
  -> system-tools.ts 调用 powershell.exe 执行命令
  -> 收集 stdout/stderr
  -> 返回 ToolResult
  -> 模型基于命令结果继续回答
```

## 工具设计

### 工具名
`run_command`

### 风险级别
`high`

原因：
- 可以执行任意系统命令
- 可能读写文件、访问网络、修改环境、启动进程
- 风险明显高于模板执行和普通只读工具
- 必须依赖用户逐次确认才能降低误触发风险

### 参数设计
建议结构：

```ts
{
  command: string;
}
```

参数约束：
- `command` 必填
- 去除纯空白命令
- 增加长度上限，避免异常超长输入，例如 `max(4000)`

建议 schema：

```ts
const runCommandSchema = z.object({
  command: z.string().min(1).max(4000),
});
```

如果希望进一步避免只有空格的命令，应在实现或 schema 中做 trim 后校验。

## 执行逻辑

### 命令执行
采用与模板执行一致的实现风格：

```ts
const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
```

好处：
- 可兼容 PowerShell 原生命令
- 也可执行常见外部命令
- 与现有 `runPowershellTemplate` 保持一致
- 易于处理 stdout/stderr 和取消信号

### 输出处理
建议规则：
- `code === 0`：返回 `stdout.trim()`，若为空则返回“命令执行完成。”
- `code !== 0`：返回 `stderr.trim()`，若为空则返回 `命令执行失败，退出码 {code}`

可选增强：
- 若 stdout 很长，做截断，避免把海量终端输出塞进上下文

考虑到当前工具已有 `10s` 超时，但没有统一输出截断机制，本次建议加入一个保守上限，例如：
- stdout / stderr 各最多保留 `12000` 字符
- 超过时在尾部追加 `...[truncated]`

这样可以减少模型上下文污染，也更适合 IDE 侧展示。

## 边界条件与异常处理
需要覆盖以下情况：

1. 命令为空
- 参数校验失败，直接拒绝执行

2. PowerShell 启动失败
- 返回 `ok: false`
- 错误内容为底层错误信息

3. 命令执行返回非 0 退出码
- 不抛异常
- 返回 stderr 或退出码错误信息

4. 命令被取消或超时
- 收到 AbortSignal 后 `child.kill()`
- 返回统一错误 `工具执行已取消。`

5. 命令无标准输出
- 成功时返回 `命令执行完成。`

6. 输出过长
- 截断 stdout / stderr
- 标记文本被截断

## 安全与取舍
本需求天然高风险，因此实现上不再附加额外复杂机制，而是依赖已有统一高风险确认流程。

### 1. 保持 high risk
这是核心安全边界。当前框架在 `executeDefinedToolCall` 中会先调用：
- `requestUserConfirmation({ toolName, risk, summary })`

因此只要工具被注册为 `high`，就会在执行前弹出确认。

### 2. 不增加命令白名单
用户明确要求“可以执行任意命令”，白名单会违背需求。

### 3. 不绕过统一确认链路
不在 `system-tools.ts` 内部再做二次确认，避免逻辑重复。统一由 `tool-registry.ts` 的执行器负责。

### 4. 不实现交互式 stdin
当前工具框架是一次性请求/响应模型，不适合交互式终端。本次只支持非交互式命令执行。

### 5. 保持 PowerShell 作为命令载体
这样改动面最小，也最符合当前仓库已有实现。

## 受影响文件

### 1. `e:\other-code\desktop-tools\src\main\system-tools.ts`
修改类型：扩展系统工具实现

预计修改内容：
- 新增输出截断辅助函数复用或扩展
- 新增 `runCommand(command, signal?)`
- 复用 `spawn` 执行 PowerShell 命令
- 处理 stdout/stderr/abort/exit code

涉及函数区域：
- `runPowershellTemplate` 附近最适合放置新函数
- 现有 `truncateText` 可直接复用到命令输出

### 2. `e:\other-code\desktop-tools\src\main\tool-registry.ts`
修改类型：扩展 schema 与工具注册

预计修改内容：
- 顶部导入新增 `runCommand`
- 新增 `runCommandSchema`
- 在 `registeredTools` 中注册 `run_command`
- risk 设为 `high`
- description 说明会执行任意命令且需用户确认

### 3. `e:\other-code\desktop-tools\.comate\specs\arbitrary-command-tool\tasks.md`
修改类型：新增任务拆解文档

### 4. `e:\other-code\desktop-tools\.comate\specs\arbitrary-command-tool\summary.md`
修改类型：实现后新增总结文档

## 关键实现片段

### `system-tools.ts` 中的执行函数示意

```ts
export async function runCommand(command: string, signal?: AbortSignal): Promise<ToolResult> {
  return new Promise<ToolResult>((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    const cleanup = () => {
      signal?.removeEventListener('abort', handleAbort);
    };

    const handleAbort = () => {
      child.kill();
      cleanup();
      reject(new Error('工具执行已取消。'));
    };

    signal?.addEventListener('abort', handleAbort, { once: true });

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      cleanup();
      reject(error);
    });

    child.on('close', (code) => {
      cleanup();

      if (code === 0) {
        resolve({
          ok: true,
          content: stdout.trim() || '命令执行完成。',
          data: { command },
        });
        return;
      }

      resolve({
        ok: false,
        content: '',
        error: stderr.trim() || `命令执行失败，退出码 ${code}`,
        data: { command },
      });
    });
  });
}
```

### `tool-registry.ts` 中的 schema 示意

```ts
const runCommandSchema = z.object({
  command: z.string().min(1).max(4000),
});
```

### 注册表示意

```ts
{
  name: 'run_command',
  description: '执行任意 PowerShell 或系统命令。高风险操作，执行前需要用户确认。',
  risk: 'high',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: '要执行的命令字符串',
      },
    },
    required: ['command'],
    additionalProperties: false,
  },
  validator: runCommandSchema,
  source: { type: 'system' },
  execute: async (args, context) => {
    const input = args as z.infer<typeof runCommandSchema>;
    return runCommand(input.command, context.signal);
  },
}
```

## 预期结果
完成后，模型将新增一个高风险系统工具：

- 工具名为 `run_command`
- 可以执行任意命令字符串
- 每次执行前必须先经过用户确认
- 成功时返回命令输出
- 失败时返回错误输出或退出码
- 仍受现有 10 秒超时与审计日志体系约束

## 实现取舍结论
本次方案选择：
- 新增通用 `run_command`
- 底层通过 PowerShell 执行命令
- 风险等级固定为 `high`
- 不绕过现有统一确认机制
- 不支持交互式输入
- 对输出进行必要截断，避免上下文污染

这是当前仓库架构下满足需求且改动最小的闭环方案。