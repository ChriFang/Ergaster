# Skills 功能重构设计文档

## 1. 需求场景

### 1.1 重构目标
将现有的 JSON 格式 Skills 重构为 Markdown 格式，符合 [AgentSkills 规范](https://agentskills.io/specification)：

1. **存储格式变更**：从 `.json` 文件改为 `.md` 文件（SKILL.md）
2. **目录结构变更**：每个 skill 存储在独立文件夹下，文件夹名称为 skill 名称
3. **UI 编辑方式变更**：提供纯文本编辑框，用户直接编辑 Markdown 内容
4. **注册信息要求**：包含 skill 名称和描述，供 LLM 按需调用

### 1.2 AgentSkills 规范概述

每个 Skill 是一个目录，结构如下：
```
skill-name/
├── SKILL.md      # 必需：元数据 + 指令
├── scripts/      # 可选：可执行代码
├── references/   # 可选：参考文档
└── assets/       # 可选：模板、资源
```

**SKILL.md 格式**：
- YAML frontmatter（元数据）
- Markdown body（技能指令）

**必需字段**：
- `name`: Skill 名称（小写字母、数字、连字符，最长64字符）
- `description`: Skill 描述（最长1024字符）

**可选字段**：
- `license`: 许可证
- `compatibility`: 兼容性要求
- `metadata`: 额外元数据
- `allowed-tools`: 预批准工具列表

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Skills Directory                          │
│  C:\Users\{user}\.desktop_tools\skills\                      │
│    ├── weather-query/                                        │
│    │   └── SKILL.md                                          │
│    ├── translate-text/                                       │
│    │   └── SKILL.md                                          │
│    └── custom-skill/                                         │
│        └── SKILL.md                                          │
└──────────────────────┬──────────────────────────────────────┘
                       │ 扫描与加载
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              UserSkillsService (重构)                        │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ scanSkillsDirectory()  扫描目录                        │ │
│  │ loadSkillFromDir()     从目录加载 SKILL.md            │ │
│  │ parseSkillMarkdown()   解析 YAML frontmatter          │ │
│  │ validateSkill()        校验 skill 定义                │ │
│  │ getSkillContent()      获取完整 skill 内容            │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────────────────┘
                       │ 注册工具 + 提供 skill 内容
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  agent-service.ts (修改)                     │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 当 LLM 决定调用 skill 时:                              │ │
│  │ 1. 读取完整的 SKILL.md 文件内容                        │ │
│  │ 2. 将 skill 内容作为上下文发送给 LLM                   │ │
│  │ 3. LLM 根据 skill 指令执行任务                         │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 LLM 调用 Skill 流程

当 LLM 决定使用某个 skill 时：

```
LLM 返回 tool_call (skill name)
    ↓
executeToolCall() 检测到是用户 skill
    ↓
读取完整的 SKILL.md 文件内容
    ↓
构造系统消息包含 skill 指令
    ↓
发送给 LLM 执行
    ↓
LLM 根据 skill 指令完成任务
    ↓
返回执行结果
```

### 2.2 数据结构

#### 2.2.1 Skill 元数据

```typescript
// src/shared/user-skills.ts

export type SkillMetadata = {
  name: string;           // 必需：skill 名称
  description: string;    // 必需：skill 描述
  license?: string;       // 可选：许可证
  compatibility?: string; // 可选：兼容性要求
  metadata?: Record<string, unknown>;  // 可选：额外元数据
  allowedTools?: string;  // 可选：预批准工具
};

export type UserSkillDefinition = {
  // 元数据
  metadata: SkillMetadata;
  
  // Markdown 内容（技能指令）
  content: string;
  
  // 文件系统信息
  directoryName: string;  // 目录名称
  directoryPath: string;  // 目录完整路径
  filePath: string;       // SKILL.md 文件路径
  
  // 执行配置（从 metadata 解析或默认）
  execute: {
    type: 'http' | 'script' | 'markdown';
    timeout?: number;
    http?: HttpExecuteConfig;
    script?: ScriptExecuteConfig;
  };
  
  // 风险等级（默认 medium）
  risk: 'low' | 'medium' | 'high';
};
```

#### 2.2.2 Skill 列表项

```typescript
// src/shared/skill-contracts.ts

export type SkillListItem = {
  name: string;
  description: string;
  directoryName: string;
  directoryPath: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
```

## 3. SKILL.md 格式设计

### 3.1 模板文件

```markdown
---
name: your-skill-name
description: A description of what this skill does and when to use it.
license: MIT
metadata:
  author: your-name
  version: "1.0"
  execute:
    type: http
    timeout: 10000
    http:
      url: https://api.example.com/endpoint
      method: GET
  risk: medium
---

# Skill Title

## Overview

Describe what this skill does.

## Instructions

### Step 1

Instructions for step 1.

### Step 2

Instructions for step 2.

## Parameters

Define the parameters this skill accepts.

## Examples

Provide examples of how to use this skill.
```

### 3.2 解析逻辑

1. **读取文件**：读取 SKILL.md 文件内容
2. **提取 frontmatter**：解析 `---` 之间的 YAML 内容
3. **解析 YAML**：使用 `yaml` 库解析为对象
4. **校验必需字段**：验证 `name` 和 `description` 存在且格式正确
5. **提取 Markdown body**：获取 frontmatter 之后的内容

### 3.3 执行配置解析

执行配置可以从 `metadata.execute` 字段获取：
```yaml
metadata:
  execute:
    type: http
    timeout: 5000
    http:
      url: https://api.example.com/weather?city={city}
      method: GET
```

或从 Markdown body 中解析特定标记。

## 4. UI 重构设计

### 4.1 SkillsPanel 组件

简化为列表展示 + 操作按钮：
- Skills 列表（名称、描述）
- 新增/编辑/删除按钮
- 打开目录按钮

### 4.2 SkillEditor 组件

改为纯文本编辑器：
- 大型文本编辑框（textarea）
- 直接编辑 SKILL.md 内容
- 默认填充模板
- 保存/取消按钮
- 预览按钮（可选）

### 4.3 编辑流程

```
点击"新增" 
  → 创建新目录（使用临时名称）
  → 创建 SKILL.md 文件（填充模板）
  → 打开编辑器
  → 用户编辑 Markdown
  → 保存时解析 frontmatter 获取 name
  → 如果 name 变更，重命名目录
```

## 5. 核心实现细节

### 5.1 文件变更记录

#### 修改文件

| 文件路径 | 修改内容 |
|---------|---------|
| `src/shared/user-skills.ts` | 重构类型定义，改为 SkillMetadata + content |
| `src/shared/skill-contracts.ts` | 简化 SkillListItem |
| `src/main/user-skills-service.ts` | 重构加载逻辑，解析 YAML frontmatter |
| `src/main/user-skill-executor.ts` | 调整执行逻辑（保持兼容） |
| `src/main/tool-registry.ts` | 调整工具注册逻辑 |
| `src/main/skill-handlers.ts` | 调整 IPC 接口 |
| `src/preload/index.ts` | 调整 API 接口 |
| `src/renderer/features/skills/SkillsPanel.tsx` | 简化 UI |
| `src/renderer/features/skills/SkillEditor.tsx` | 改为文本编辑器 |

#### 新增依赖

- `yaml`：用于解析 YAML frontmatter

### 5.2 关键代码实现

#### 5.2.1 Skill 解析

```typescript
// src/main/user-skills-service.ts

import { parse as parseYaml } from 'yaml';

async function loadSkillFromDirectory(dirPath: string): Promise<UserSkillDefinition | null> {
  const skillFilePath = path.join(dirPath, 'SKILL.md');
  
  if (!await fileExists(skillFilePath)) {
    return null;
  }
  
  const content = await fs.readFile(skillFilePath, 'utf-8');
  const { metadata, body } = parseSkillMarkdown(content);
  
  if (!metadata.name || !metadata.description) {
    throw new Error('Skill must have name and description');
  }
  
  return {
    metadata,
    content: body,
    directoryName: path.basename(dirPath),
    directoryPath: dirPath,
    filePath: skillFilePath,
    execute: parseExecuteConfig(metadata),
    risk: parseRiskLevel(metadata),
  };
}

function parseSkillMarkdown(content: string): { metadata: SkillMetadata; body: string } {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);
  
  if (!match) {
    throw new Error('Invalid SKILL.md format: missing frontmatter');
  }
  
  const yamlContent = match[1];
  const body = match[2];
  
  const metadata = parseYaml(yamlContent) as SkillMetadata;
  
  return { metadata, body };
}
```

#### 5.2.2 工具注册

```typescript
// src/main/tool-registry.ts

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
      name: skill.metadata.name,
      description: skill.metadata.description,
      // 参数从 metadata.execute 或 body 解析
      parameters: skill.parameters ?? { type: 'object', properties: {} },
      strict: true,
    },
  }));

  return [...systemTools, ...userTools];
}
```

### 5.3 目录结构示例

```
C:\Users\user\.desktop_tools\skills\
├── weather-query\
│   └── SKILL.md
├── translate-text\
│   ├── SKILL.md
│   └── scripts\
│       └── translate.py
└── pdf-processing\
    └── SKILL.md
```

## 6. 边界条件与异常处理

### 6.1 文件处理
- **目录不存在**: 自动创建 skills 目录
- **SKILL.md 不存在**: 跳过该目录
- **frontmatter 格式错误**: 记录错误日志，跳过该 skill
- **缺少必需字段**: 记录错误日志，跳过该 skill
- **名称冲突**: 先加载的优先生效

### 6.2 名称规范
- **格式**: `^[a-z][a-z0-9-]*$`（小写字母、数字、连字符）
- **长度**: 最长 64 字符
- **目录名**: 与 skill name 保持一致

### 6.3 安全考虑
- **YAML 解析**: 使用安全解析，防止代码注入
- **文件操作**: 限制在 skills 目录内
- **执行权限**: 保持风险等级控制

## 7. 数据流

### 7.1 Skills 加载流程
```
应用启动
  → 扫描 ~/.desktop_tools/skills 目录
  → 遍历所有子目录
  → 检查是否存在 SKILL.md
  → 读取文件内容
  → 解析 YAML frontmatter
  → 校验 name 和 description
  → 提取 Markdown body
  → 解析执行配置
  → 注册到工具列表
```

### 7.2 Skill 创建流程
```
用户点击"新增"
  → 生成临时目录名
  → 创建目录
  → 使用模板创建 SKILL.md
  → 打开编辑器
  → 用户编辑内容
  → 保存时解析 frontmatter
  → 获取 skill name
  → 如果 name 与目录名不同，重命名目录
  → 刷新 skills 列表
```

## 8. 受影响的文件列表

| 文件路径 | 修改类型 | 说明 |
|---------|---------|------|
| `src/shared/user-skills.ts` | 重构 | 类型定义改为 SkillMetadata |
| `src/shared/skill-contracts.ts` | 重构 | 简化接口定义 |
| `src/main/user-skills-service.ts` | 重构 | 目录扫描和 YAML 解析 |
| `src/main/user-skill-executor.ts` | 修改 | 保持执行逻辑兼容 |
| `src/main/tool-registry.ts` | 修改 | 调整工具注册 |
| `src/main/skill-handlers.ts` | 修改 | 调整 IPC 接口 |
| `src/preload/index.ts` | 修改 | 调整 API |
| `src/renderer/features/skills/SkillsPanel.tsx` | 重构 | 简化 UI |
| `src/renderer/features/skills/SkillEditor.tsx` | 重构 | 改为文本编辑器 |
| `package.json` | 修改 | 添加 yaml 依赖 |
| `doc/skills/template.md` | 修改 | 更新模板内容 |

## 9. 预期成果

### 9.1 功能成果
1. Skills 存储 Markdown 格式，符合 AgentSkills 规范
2. 每个 skill 存储在独立目录下
3. UI 提供纯文本编辑器
4. 默认提供模板内容
5. 工具列表包含名称和描述

### 9.2 兼容性成果
1. 保持与现有执行引擎的兼容
2. 保持风险控制机制
3. 保持用户确认流程

## 10. 测试计划

### 10.1 单元测试
- YAML frontmatter 解析
- 目录扫描逻辑
- 名称校验逻辑
- 执行配置解析

### 10.2 集成测试
- Skill 创建、编辑、删除
- LLM 调用 skill
- 目录重命名
- 错误处理

### 10.3 手动测试
- 创建新 skill
- 编辑现有 skill
- 测试模板内容
- 测试 LLM 调用
