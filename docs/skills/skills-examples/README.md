# 用户自定义 Skills 使用说明

## 概述

Ergaster 支持用户自定义 Skills，采用 [AgentSkills 规范](https://agentskills.io/specification)。每个 Skill 是一个包含 `SKILL.md` 文件的目录，使用 Markdown 格式定义。

## Skills 目录位置

```
C:\Users\{用户名}\.ergaster\skills\
```

应用启动时会自动创建此目录（如果不存在）。

## 目录结构

```
skills/
├── weather-query/
│   └── SKILL.md
├── translate-text/
│   ├── SKILL.md
│   └── scripts/
│       └── translate.py
└── pdf-processing/
    └── SKILL.md
```

每个 Skill 必须是一个目录，目录下必须有 `SKILL.md` 文件。

## SKILL.md 格式

```markdown
---
name: skill-name
description: A description of what this skill does and when to use it.
license: MIT
metadata:
  author: your-name
  version: "1.0"
  risk: medium
---

# Skill Title

## Overview

Describe what this skill does.

## Instructions

Step-by-step instructions for the AI to follow.
```

## YAML Frontmatter 字段

### 必需字段

| 字段 | 类型 | 说明 |
|-----|------|------|
| `name` | string | Skill 名称（小写字母、数字、连字符，最长64字符） |
| `description` | string | Skill 描述（最长1024字符） |

### 可选字段

| 字段 | 类型 | 说明 |
|-----|------|------|
| `license` | string | 许可证 |
| `metadata.author` | string | 作者 |
| `metadata.version` | string | 版本号 |
| `metadata.risk` | string | 风险等级：`low`、`medium`、`high` |

## 如何添加自定义 Skill

### 方法一：通过 UI 界面添加

1. 点击应用右上角的 "Skills" 按钮
2. 点击 "+ 新增 Skill" 按钮
3. 在编辑器中填写 Skill 内容
4. 点击 "保存"

### 方法二：手动添加文件

1. 打开 Skills 目录
2. 创建一个新的目录（目录名建议与 Skill name 一致）
3. 在目录下创建 `SKILL.md` 文件
4. 按照 YAML frontmatter + Markdown 格式编写内容
5. 重启应用，Skill 会自动加载

## LLM 调用流程

当 LLM 决定使用某个 Skill 时：

1. LLM 从工具列表中选择 Skill（根据 name 和 description）
2. 系统读取完整的 `SKILL.md` 文件内容
3. Skill 内容作为上下文发送给 LLM
4. LLM 根据 Skill 中的指令执行任务
5. 返回执行结果

## 风险等级说明

| 等级 | 说明 | 用户确认 |
|-----|------|---------|
| `low` | 低风险操作 | 自动通过 |
| `medium` | 中等风险操作 | 需要用户确认 |
| `high` | 高风险操作 | 需要用户确认 |

## 最佳实践

1. **清晰的描述**：在 `description` 中清楚说明 Skill 的用途
2. **详细的指令**：在 Markdown body 中提供详细的执行指令
3. **参数说明**：如果 Skill 需要参数，在 Markdown 中说明
4. **示例**：提供使用示例帮助 LLM 理解

## 模板文件

参考 `doc/skills/template.md` 获取完整的模板示例。

## 注意事项

- Skill 名称必须唯一，冲突时先加载的优先生效
- 目录名和 Skill name 可以不同，但建议保持一致
- `SKILL.md` 文件必须使用 UTF-8 编码
- YAML frontmatter 格式错误会导致 Skill 加载失败
