# 用户自定义 Skills 自动扫描与注册功能设计文档

## 1. 需求场景

### 1.1 用户需求
用户希望在指定目录 `C:\Users\{用户名}\.desktop_tools\skills` 下手动添加 skills 配置文件，系统能够：
- 自动扫描该目录下的所有 skills 文件
- 解析并验证 skills 定义
- 动态注册到工具列表中供 LLM 调用
- 支持应用启动时自动加载和运行时热重载

### 1.2 处理逻辑
1. **应用启动时**：扫描 skills 目录，加载所有合法的 skills 文件
2. **运行时监听**：监听目录变化，支持动态添加/修改/删除 skills
3. **工具注册**：将用户 skills 合并到系统工具列表，供 LLM 使用
4. **安全控制**：严格校验 skills 定义，限制执行权限

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Skills Directory                          │
│  C:\Users\{user}\.desktop_tools\skills\                      │
│    ├── weather.json                                          │
│    ├── translate.json                                        │
│    └── custom-tool.json                                      │
└──────────────────────┬──────────────────────────────────────┘
                       │ 扫描与加载
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              UserSkillsService (新增)                        │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ scanSkillsDirectory()  扫描目录                        │ │
│  │ loadSkillFile()        加载单个文件                    │ │
│  │ validateSkill()        校验 skills 定义                │ │
│  │ watchDirectory()       监听目录变化                    │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────────────────┘
                       │ 注册工具
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  tool-registry.ts (修改)                     │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ registeredTools[]      系统内置工具（不变）            │ │
│  │ userSkills[]           用户自定义工具（新增）          │ │
│  │ getRegisteredTools()   合并返回所有工具                │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────────────────┘
                       │ 提供给 LLM
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   agent-service.ts                           │
│                  通过 getRegisteredTools()                   │
│                  获取所有工具 schema                          │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 技术选型
- **文件格式**: JSON（易于编辑和验证）
- **参数校验**: Zod（与现有工具校验一致）
- **目录监听**: Node.js `fs.watch`（支持热重载）
- **执行引擎**: 根据 skill 类型分别处理

## 3. Skills 文件格式设计

### 3.1 JSON Schema 定义

```typescript
// src/shared/user-skills.ts

export type UserSkillExecuteType = 'http' | 'script';

export type UserSkillDefinition = {
  // 元数据
  id: string;                      // 唯一标识，格式：string (建议使用 kebab-case)
  name: string;                    // 工具名称，格式：^[a-z][a-z0-9_]*$
  version: string;                 // 版本号，格式：semver
  description: string;             // 工具描述（供 LLM 理解）
  author?: string;                 // 作者信息
  
  // 工具定义
  risk: 'low' | 'medium' | 'high'; // 风险等级
  parameters: {                    // 参数定义（JSON Schema 格式）
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      default?: unknown;
    }>;
    required?: string[];
  };
  
  // 执行配置
  execute: {
    type: UserSkillExecuteType;
    timeout?: number;              // 超时时间（毫秒），默认 10000
    
    // HTTP 执行配置
    http?: {
      url: string;                 // URL 模板，支持 {param} 占位符
      method: 'GET' | 'POST';
      headers?: Record<string, string>;
      body?: string;               // POST 请求体模板
    };
    
    // 脚本执行配置
    script?: {
      command: string;             // 命令或脚本路径
      args?: string[];             // 参数模板，支持 {param} 占位符
    };
  };
};
```

### 3.2 示例 Skills 文件

**weather.json - HTTP 类型工具**
```json
{
  "id": "weather-query",
  "name": "query_weather",
  "version": "1.0.0",
  "description": "查询指定城市的天气信息。城市名称支持中文和拼音。",
  "author": "user",
  "risk": "low",
  "parameters": {
    "type": "object",
    "properties": {
      "city": {
        "type": "string",
        "description": "城市名称，如：北京、beijing"
      }
    },
    "required": ["city"]
  },
  "execute": {
    "type": "http",
    "timeout": 5000,
    "http": {
      "url": "https://api.example.com/weather?city={city}",
      "method": "GET",
      "headers": {
        "Accept": "application/json"
      }
    }
  }
}
```

**translate.json - Script 类型工具**
```json
{
  "id": "translate-text",
  "name": "translate",
  "version": "1.0.0",
  "description": "翻译文本到目标语言",
  "risk": "medium",
  "parameters": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string",
        "description": "要翻译的文本"
      },
      "targetLang": {
        "type": "string",
        "description": "目标语言，如：en, ja, ko",
        "enum": ["en", "ja", "ko", "fr", "de"]
      }
    },
    "required": ["text", "targetLang"]
  },
  "execute": {
    "type": "script",
    "timeout": 10000,
    "script": {
      "command": "python",
      "args": ["{__dirname}/scripts/translate.py", "{text}", "{targetLang}"]
    }
  }
}
```

## 4. 核心实现细节

### 4.1 文件变更记录

#### 新增文件

**src/main/user-skills-service.ts**
- `UserSkillsService` 类：管理用户 skills 的核心服务
- `scanSkillsDirectory()`: 扫描 skills 目录
- `loadSkillFile()`: 加载并解析单个 skill 文件
- `validateSkill()`: 使用 Zod 校验 skill 定义
- `watchDirectory()`: 监听目录变化（可选功能）
- `executeUserSkill()`: 执行用户 skill

**src/shared/user-skills.ts**
- 类型定义：`UserSkillDefinition`, `UserSkillExecuteType`
- Zod schemas：`userSkillSchema`

**src/main/user-skill-executor.ts**
- `executeHttpSkill()`: 执行 HTTP 类型的 skill
- `executeScriptSkill()`: 执行脚本类型的 skill
- 参数替换逻辑：处理 `{param}` 占位符

#### 修改文件

**src/main/tool-registry.ts**
- 新增 `userSkills: Map<string, UserSkillDefinition>` 存储用户 skills
- 修改 `getRegisteredTools()`: 合并系统工具和用户 skills
- 新增 `registerUserSkill()`: 注册单个用户 skill
- 新增 `unregisterUserSkill()`: 注销用户 skill
- 新增 `loadUserSkills()`: 启动时加载所有用户 skills

**src/main/index.ts**
- 在 `app.whenReady()` 后调用 `loadUserSkills()`

**src/shared/tools.ts**
- 新增 `UserToolDefinition` 类型（可选，用于区分系统工具和用户工具）

### 4.2 关键代码实现

#### 4.2.1 Skills 扫描服务

```typescript
// src/main/user-skills-service.ts

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { userSkillSchema } from '../shared/user-skills';
import type { UserSkillDefinition } from '../shared/user-skills';
import { appendMainLog } from './audit-log';

export class UserSkillsService {
  private skillsDir: string;
  private loadedSkills: Map<string, UserSkillDefinition> = new Map();
  
  constructor() {
    this.skillsDir = path.join(os.homedir(), '.desktop_tools', 'skills');
  }
  
  async scanAndLoadSkills(): Promise<void> {
    try {
      // 确保目录存在
      await fs.mkdir(this.skillsDir, { recursive: true });
      
      const files = await fs.readdir(this.skillsDir);
      const jsonFiles = files.filter(file => file.endsWith('.json'));
      
      for (const file of jsonFiles) {
        const filePath = path.join(this.skillsDir, file);
        await this.loadSkillFile(filePath);
      }
      
      await appendMainLog('INFO', `Loaded ${this.loadedSkills.size} user skills from ${this.skillsDir}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await appendMainLog('ERROR', `Failed to scan skills directory: ${message}`);
    }
  }
  
  async loadSkillFile(filePath: string): Promise<UserSkillDefinition | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      
      // Zod 校验
      const validation = userSkillSchema.safeParse(parsed);
      
      if (!validation.success) {
        await appendMainLog('ERROR', `Invalid skill file ${filePath}: ${validation.error.message}`);
        return null;
      }
      
      const skill = validation.data;
      
      // 检查 name 冲突
      if (this.loadedSkills.has(skill.name)) {
        await appendMainLog('WARN', `Skill name conflict: ${skill.name} already loaded`);
        return null;
      }
      
      this.loadedSkills.set(skill.name, skill);
      await appendMainLog('INFO', `Loaded user skill: ${skill.name} from ${filePath}`);
      
      return skill;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await appendMainLog('ERROR', `Failed to load skill file ${filePath}: ${message}`);
      return null;
    }
  }
  
  getLoadedSkills(): UserSkillDefinition[] {
    return Array.from(this.loadedSkills.values());
  }
  
  getSkill(name: string): UserSkillDefinition | undefined {
    return this.loadedSkills.get(name);
  }
}

// 单例导出
export const userSkillsService = new UserSkillsService();
```

#### 4.2.2 Skills 执行引擎

```typescript
// src/main/user-skill-executor.ts

import { spawn } from 'node:child_process';
import path from 'node:path';
import type { UserSkillDefinition, ToolResult, ToolContext } from '../shared/types';

export async function executeUserSkill(
  skill: UserSkillDefinition,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const timeout = skill.execute.timeout ?? 10000;
  
  switch (skill.execute.type) {
    case 'http':
      return executeHttpSkill(skill, args, timeout, context.signal);
    case 'script':
      return executeScriptSkill(skill, args, timeout, context.signal);
    default:
      return {
        ok: false,
        content: '',
        error: `不支持的执行类型: ${skill.execute.type}`,
      };
  }
}

async function executeHttpSkill(
  skill: UserSkillDefinition,
  args: Record<string, unknown>,
  timeout: number,
  signal: AbortSignal
): Promise<ToolResult> {
  const httpConfig = skill.execute.http;
  if (!httpConfig) {
    return { ok: false, content: '', error: 'HTTP 配置缺失' };
  }
  
  // 替换 URL 中的占位符
  let url = httpConfig.url;
  for (const [key, value] of Object.entries(args)) {
    url = url.replace(`{${key}}`, encodeURIComponent(String(value)));
  }
  
  try {
    const timeoutSignal = AbortSignal.timeout(timeout);
    const combinedSignal = AbortSignal.any([signal, timeoutSignal]);
    
    const response = await fetch(url, {
      method: httpConfig.method,
      headers: httpConfig.headers,
      signal: combinedSignal,
      body: httpConfig.method === 'POST' ? httpConfig.body : undefined,
    });
    
    const text = await response.text();
    
    return {
      ok: response.ok,
      content: text.slice(0, 8000),
      error: response.ok ? undefined : `HTTP ${response.status}`,
      data: { url, status: response.status },
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, content: '', error: '请求超时或已取消' };
    }
    return { ok: false, content: '', error: error instanceof Error ? error.message : '请求失败' };
  }
}

async function executeScriptSkill(
  skill: UserSkillDefinition,
  args: Record<string, unknown>,
  timeout: number,
  signal: AbortSignal
): Promise<ToolResult> {
  const scriptConfig = skill.execute.script;
  if (!scriptConfig) {
    return { ok: false, content: '', error: 'Script 配置缺失' };
  }
  
  return new Promise((resolve, reject) => {
    const child = spawn(scriptConfig.command, scriptConfig.args ?? [], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
    });
    
    let stdout = '';
    let stderr = '';
    let timeoutId: NodeJS.Timeout | null = null;
    
    const cleanup = () => {
      signal.removeEventListener('abort', handleAbort);
      if (timeoutId) clearTimeout(timeoutId);
    };
    
    const handleAbort = () => {
      child.kill();
      cleanup();
      reject(new Error('工具执行已取消'));
    };
    
    signal.addEventListener('abort', handleAbort, { once: true });
    
    timeoutId = setTimeout(() => {
      child.kill();
      cleanup();
      resolve({ ok: false, content: '', error: '脚本执行超时' });
    }, timeout);
    
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    
    child.on('error', (error) => {
      cleanup();
      resolve({ ok: false, content: '', error: error.message });
    });
    
    child.on('close', (code) => {
      cleanup();
      if (code === 0) {
        resolve({
          ok: true,
          content: stdout.slice(0, 8000) || '脚本执行成功',
          data: { exitCode: code },
        });
      } else {
        resolve({
          ok: false,
          content: '',
          error: stderr || `脚本执行失败，退出码 ${code}`,
        });
      }
    });
  });
}
```

#### 4.2.3 工具注册中心扩展

```typescript
// src/main/tool-registry.ts (修改部分)

import { userSkillsService } from './user-skills-service';
import { executeUserSkill } from './user-skill-executor';

// 新增：用户 skills 存储
const userSkillDefinitions = new Map<string, UserSkillDefinition>();

// 新增：加载用户 skills
export async function loadUserSkills() {
  await userSkillsService.scanAndLoadSkills();
  
  const skills = userSkillsService.getLoadedSkills();
  for (const skill of skills) {
    registerUserSkill(skill);
  }
}

// 新增：注册单个用户 skill
function registerUserSkill(skill: UserSkillDefinition) {
  userSkillDefinitions.set(skill.name, skill);
}

// 修改：合并系统工具和用户 skills
export function getRegisteredTools() {
  const systemTools = registeredTools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: tool.strict,
    },
  }));
  
  const userTools = Array.from(userSkillDefinitions.values()).map((skill) => ({
    type: 'function' as const,
    function: {
      name: skill.name,
      description: skill.description,
      parameters: skill.parameters,
      strict: true,
    },
  }));
  
  return [...systemTools, ...userTools];
}

// 修改：扩展 executeToolCall
export async function executeToolCall(
  toolCall: ToolCall,
  signal: AbortSignal,
): Promise<DeepSeekApiMessage> {
  // 先查找系统工具
  let tool = toolMap.get(toolCall.function.name);
  
  // 如果不是系统工具，查找用户 skill
  if (!tool) {
    const userSkill = userSkillDefinitions.get(toolCall.function.name);
    if (userSkill) {
      // 构建 ToolDefinition
      tool = {
        name: userSkill.name,
        description: userSkill.description,
        risk: userSkill.risk,
        strict: true,
        parameters: userSkill.parameters as ToolSchemaShape,
        validator: buildValidatorFromParameters(userSkill.parameters),
        execute: async (args, context) => executeUserSkill(userSkill, args as Record<string, unknown>, context),
      };
    }
  }
  
  // ... 后续逻辑保持不变
}

// 新增：从 parameters 构建简单的 Zod validator
function buildValidatorFromParameters(parameters: UserSkillDefinition['parameters']) {
  // 使用 z.object 和 parameters 定义构建 validator
  // 简化实现，实际可以使用 zod-json-schema 或手动构建
}
```

#### 4.2.4 应用启动集成

```typescript
// src/main/index.ts (修改部分)

import { loadUserSkills } from './tool-registry';

app.whenReady().then(async () => {
  // ... 现有初始化逻辑
  
  // 加载用户 skills
  await loadUserSkills();
  
  // ... 其他逻辑
});
```

## 5. 边界条件与异常处理

### 5.1 文件处理
- **目录不存在**: 自动创建 `~/.desktop_tools/skills` 目录
- **文件格式错误**: 记录错误日志，跳过该文件，不影响其他 skills
- **JSON 解析失败**: 记录错误日志，跳过该文件
- **名称冲突**: 优先使用先加载的 skill，记录警告日志

### 5.2 执行安全
- **参数校验失败**: 返回错误信息，不执行 skill
- **HTTP 请求超时**: 默认 10 秒，可配置
- **脚本执行超时**: 强制终止进程
- **权限控制**: 根据 risk 等级请求用户确认（与系统工具一致）

### 5.3 网络安全
- **URL 白名单**: 初期版本不做限制，后续可配置白名单
- **敏感信息过滤**: 不允许在 headers 中传递敏感信息
- **请求方法限制**: 仅支持 GET 和 POST

### 5.4 脚本安全
- **命令白名单**: 初期版本仅允许执行预定义命令
- **路径限制**: 脚本路径必须在 skills 目录内
- **参数转义**: 防止命令注入攻击

## 6. 数据流

### 6.1 Skills 加载流程
```
应用启动
  → 调用 loadUserSkills()
  → 扫描 ~/.desktop_tools/skills 目录
  → 读取所有 .json 文件
  → JSON 解析
  → Zod 校验
  → 名称冲突检查
  → 注册到 userSkillDefinitions
  → 合并到 getRegisteredTools()
  → 提供给 LLM
```

### 6.2 Skill 调用流程
```
LLM 返回 tool_call
  → executeToolCall()
  → 查找系统工具（失败）
  → 查找用户 skill（成功）
  → 参数校验
  → 用户确认（根据 risk）
  → executeUserSkill()
  → 根据 execute.type 路由
    → HTTP: fetch(url, options)
    → Script: spawn(command, args)
  → 返回 ToolResult
  → 构造 tool message
  → 返回给 LLM
```

## 7. UI 管理功能设计

### 7.1 UI 架构

```
┌─────────────────────────────────────────────────────────────┐
│                     App.tsx                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ [Settings] [Skills管理] 按钮                            │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ SettingsPanel (现有)                                    │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ SkillsPanel (新增)                                      │ │
│  │  - Skills 列表展示                                      │ │
│  │  - 新增/编辑/删除按钮                                   │ │
│  │  - Skill 编辑表单                                       │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                       │ IPC 通信
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   Main Process                               │
│  ipcMain.handle('skill:list')                                │
│  ipcMain.handle('skill:create')                              │
│  ipcMain.handle('skill:update')                              │
│  ipcMain.handle('skill:delete')                              │
│  ipcMain.handle('skill:validate')                            │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 IPC 接口设计

#### 7.2.1 接口定义

```typescript
// src/shared/skill-contracts.ts

export type SkillListItem = {
  id: string;
  name: string;
  description: string;
  version: string;
  risk: 'low' | 'medium' | 'high';
  executeType: 'http' | 'script';
  enabled: boolean;
  filePath: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateSkillRequest = UserSkillDefinition;

export type UpdateSkillRequest = {
  id: string;
  updates: Partial<UserSkillDefinition>;
};

export type SkillOperationResult = {
  ok: boolean;
  error?: string;
  data?: unknown;
};
```

#### 7.2.2 IPC 处理器实现

```typescript
// src/main/skill-handlers.ts

import { ipcMain } from 'electron';
import { userSkillsService } from './user-skills-service';
import type { SkillListItem, CreateSkillRequest, UpdateSkillRequest, SkillOperationResult } from '../shared/skill-contracts';

export function registerSkillHandlers() {
  // 获取所有 skills 列表
  ipcMain.handle('skill:list', async (): Promise<SkillListItem[]> => {
    return userSkillsService.getSkillListItems();
  });

  // 创建新 skill
  ipcMain.handle('skill:create', async (_event, request: CreateSkillRequest): Promise<SkillOperationResult> => {
    try {
      const skill = await userSkillsService.createSkill(request);
      return { ok: true, data: skill };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '创建失败' };
    }
  });

  // 更新 skill
  ipcMain.handle('skill:update', async (_event, request: UpdateSkillRequest): Promise<SkillOperationResult> => {
    try {
      await userSkillsService.updateSkill(request.id, request.updates);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '更新失败' };
    }
  });

  // 删除 skill
  ipcMain.handle('skill:delete', async (_event, skillId: string): Promise<SkillOperationResult> => {
    try {
      await userSkillsService.deleteSkill(skillId);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '删除失败' };
    }
  });

  // 校验 skill 定义
  ipcMain.handle('skill:validate', async (_event, skillJson: unknown): Promise<SkillOperationResult> => {
    const validation = userSkillSchema.safeParse(skillJson);
    return {
      ok: validation.success,
      error: validation.success ? undefined : validation.error.issues.map(i => i.message).join('; '),
    };
  });

  // 获取单个 skill 详情
  ipcMain.handle('skill:get', async (_event, skillName: string): Promise<UserSkillDefinition | null> => {
    return userSkillsService.getSkill(skillName) ?? null;
  });
}
```

### 7.3 渲染进程组件

#### 7.3.1 SkillsPanel 组件

```tsx
// src/renderer/features/skills/SkillsPanel.tsx

import { useState, useEffect } from 'react';
import type { SkillListItem, UserSkillDefinition } from '../../../shared/skill-contracts';

type Props = {
  onClose: () => void;
};

export function SkillsPanel({ onClose }: Props) {
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [editingSkill, setEditingSkill] = useState<UserSkillDefinition | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    loadSkills();
  }, []);

  async function loadSkills() {
    const result = await window.desktopApp.listSkills();
    setSkills(result);
  }

  async function handleDelete(skillId: string) {
    if (!confirm('确定要删除此 skill 吗？')) return;
    
    const result = await window.desktopApp.deleteSkill(skillId);
    if (result.ok) {
      await loadSkills();
    } else {
      alert(result.error);
    }
  }

  function handleEdit(skill: SkillListItem) {
    // 加载完整 skill 定义并打开编辑器
    window.desktopApp.getSkill(skill.name).then((fullSkill) => {
      if (fullSkill) {
        setEditingSkill(fullSkill);
        setIsCreating(false);
      }
    });
  }

  function handleCreate() {
    setEditingSkill(createEmptySkill());
    setIsCreating(true);
  }

  return (
    <div className="skills-panel">
      <div className="skills-header">
        <h2>Skills 管理</h2>
        <button onClick={onClose}>关闭</button>
      </div>

      <div className="skills-content">
        {editingSkill ? (
          <SkillEditor
            skill={editingSkill}
            isCreating={isCreating}
            onSave={async (skill) => {
              const result = isCreating
                ? await window.desktopApp.createSkill(skill)
                : await window.desktopApp.updateSkill({ id: skill.id, updates: skill });
              
              if (result.ok) {
                setEditingSkill(null);
                await loadSkills();
              } else {
                alert(result.error);
              }
            }}
            onCancel={() => setEditingSkill(null)}
          />
        ) : (
          <>
            <div className="skills-toolbar">
              <button onClick={handleCreate}>新增 Skill</button>
            </div>

            <div className="skills-list">
              {skills.map((skill) => (
                <div key={skill.id} className="skill-item">
                  <div className="skill-info">
                    <h3>{skill.name}</h3>
                    <p>{skill.description}</p>
                    <div className="skill-meta">
                      <span className={`risk-${skill.risk}`}>{skill.risk}</span>
                      <span>{skill.executeType}</span>
                      <span>v{skill.version}</span>
                    </div>
                  </div>
                  <div className="skill-actions">
                    <button onClick={() => handleEdit(skill)}>编辑</button>
                    <button onClick={() => handleDelete(skill.id)}>删除</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function createEmptySkill(): UserSkillDefinition {
  return {
    id: `skill-${Date.now()}`,
    name: '',
    version: '1.0.0',
    description: '',
    risk: 'low',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    execute: {
      type: 'http',
      timeout: 10000,
      http: {
        url: '',
        method: 'GET',
      },
    },
  };
}
```

#### 7.3.2 SkillEditor 组件

```tsx
// src/renderer/features/skills/SkillEditor.tsx

import { useState, type FormEvent } from 'react';
import type { UserSkillDefinition } from '../../../shared/skill-contracts';

type Props = {
  skill: UserSkillDefinition;
  isCreating: boolean;
  onSave: (skill: UserSkillDefinition) => Promise<void>;
  onCancel: () => void;
};

export function SkillEditor({ skill: initialSkill, isCreating, onSave, onCancel }: Props) {
  const [skill, setSkill] = useState<UserSkillDefinition>(initialSkill);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(skill);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="skill-editor" onSubmit={handleSubmit}>
      <h3>{isCreating ? '创建 Skill' : '编辑 Skill'}</h3>

      <div className="form-group">
        <label>名称 (仅允许字母、数字、下划线)</label>
        <input
          value={skill.name}
          onChange={(e) => setSkill({ ...skill, name: e.target.value })}
          placeholder="query_weather"
          required
          pattern="^[a-z][a-z0-9_]*$"
        />
      </div>

      <div className="form-group">
        <label>描述</label>
        <textarea
          value={skill.description}
          onChange={(e) => setSkill({ ...skill, description: e.target.value })}
          placeholder="查询指定城市的天气信息"
          required
        />
      </div>

      <div className="form-group">
        <label>风险等级</label>
        <select
          value={skill.risk}
          onChange={(e) => setSkill({ ...skill, risk: e.target.value as UserSkillDefinition['risk'] })}
        >
          <option value="low">低风险</option>
          <option value="medium">中风险</option>
          <option value="high">高风险</option>
        </select>
      </div>

      <div className="form-group">
        <label>执行类型</label>
        <select
          value={skill.execute.type}
          onChange={(e) => setSkill({
            ...skill,
            execute: {
              ...skill.execute,
              type: e.target.value as 'http' | 'script',
            },
          })}
        >
          <option value="http">HTTP 请求</option>
          <option value="script">脚本执行</option>
        </select>
      </div>

      {skill.execute.type === 'http' && (
        <HttpConfigEditor
          config={skill.execute.http!}
          onChange={(http) => setSkill({
            ...skill,
            execute: { ...skill.execute, http },
          })}
        />
      )}

      {skill.execute.type === 'script' && (
        <ScriptConfigEditor
          config={skill.execute.script!}
          onChange={(script) => setSkill({
            ...skill,
            execute: { ...skill.execute, script },
          })}
        />
      )}

      <div className="form-actions">
        <button type="submit" disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </button>
        <button type="button" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}
```

### 7.4 Preload 脚本扩展

```typescript
// src/preload/index.ts (新增部分)

import { contextBridge, ipcRenderer } from 'electron';

// 在现有 window.desktopApp 基础上新增方法
contextBridge.exposeInMainWorld('desktopApp', {
  // ... 现有方法

  // Skills 管理
  listSkills: () => ipcRenderer.invoke('skill:list'),
  getSkill: (name: string) => ipcRenderer.invoke('skill:get', name),
  createSkill: (skill: UserSkillDefinition) => ipcRenderer.invoke('skill:create', skill),
  updateSkill: (request: UpdateSkillRequest) => ipcRenderer.invoke('skill:update', request),
  deleteSkill: (id: string) => ipcRenderer.invoke('skill:delete', id),
  validateSkill: (skillJson: unknown) => ipcRenderer.invoke('skill:validate', skillJson),
});
```

### 7.5 UI 功能清单

| 功能 | 操作 | IPC 接口 | 说明 |
|-----|------|---------|------|
| 列表展示 | 查询 | `skill:list` | 显示所有已加载的 skills |
| 新增 | 创建 | `skill:create` | 表单填写并保存为新 JSON 文件 |
| 编辑 | 更新 | `skill:update` | 修改现有 skill 定义并更新文件 |
| 删除 | 删除 | `skill:delete` | 删除 skill 文件并从内存中移除 |
| 参数定义 | 可视化编辑 | - | 动态添加/删除参数字段 |
| 实时校验 | 校验 | `skill:validate` | 编辑时实时校验输入 |

## 8. 预期成果

### 8.1 功能成果
1. 支持用户在 `~/.desktop_tools/skills` 目录下放置 JSON 文件定义自定义工具
2. 应用启动时自动扫描并加载所有合法的 skills
3. **UI 界面支持 skills 的增删改查操作**
4. LLM 可以调用用户自定义的 skills，与系统工具无差别
5. 支持两种执行类型：HTTP 请求和脚本执行
6. 完整的错误处理和日志记录

### 8.2 安全成果
1. 所有 skills 需要通过 Zod 校验
2. 根据风险等级进行用户确认
3. 执行超时保护
4. 防止命令注入和路径遍历攻击

### 8.3 可扩展性
1. 预留了目录监听接口，可后续支持热重载
2. 执行引擎可扩展支持更多类型（如 template）
3. 参数校验机制可扩展

## 9. 受影响的文件列表

| 文件路径 | 修改类型 | 说明 |
|---------|---------|------|
| `src/shared/user-skills.ts` | 新增 | 用户 skills 类型定义和 Zod schemas |
| `src/main/user-skills-service.ts` | 新增 | Skills 扫描、加载和管理服务 |
| `src/main/user-skill-executor.ts` | 新增 | Skills 执行引擎 |
| `src/main/tool-registry.ts` | 修改 | 集成用户 skills 注册和执行 |
| `src/main/index.ts` | 修改 | 应用启动时加载用户 skills |
| `~/.desktop_tools/skills/*.json` | 用户创建 | 用户自定义 skills 文件 |

## 9. 测试计划

### 9.1 单元测试
- `userSkillSchema.safeParse()` 校验各种合法/非法 JSON
- `scanSkillsDirectory()` 模拟目录不存在、空目录、多个文件
- `executeHttpSkill()` 模拟超时、取消、错误响应
- `executeScriptSkill()` 模拟超时、取消、执行失败

### 9.2 集成测试
- 应用启动后 skills 正确加载
- LLM 调用用户 skill 并获得正确响应
- 错误的 skill 文件不影响其他 skills
- 用户确认流程正常工作

### 9.3 手动测试
- 创建 `weather.json` 测试 HTTP 类型 skill
- 创建 `custom-script.json` 测试 Script 类型 skill
- 测试参数校验和错误处理
- 测试用户确认流程
