# Skill 相对路径支持

## 问题分析

当 skill 文件中引用相对路径文件（如 `./docs/api.md`），LLM 收到 skill 内容后无法解析这些路径，因为不知道 skill 所在的目录。

## 解决方案

在返回给 LLM 的 skill 内容中，自动注入 skill 目录路径信息。

### 修改文件

**`src/main/user-skills-service.ts`**

修改 `buildFullMarkdown` 方法，在内容开头注入目录路径注释：

```typescript
buildFullMarkdown(skill: UserSkillDefinition): string {
  const frontmatter = stringifyYaml(skill.metadata as Record<string, unknown>);
  const pathInfo = `> **Skill Directory**: \`${skill.directoryPath}\`\n\n`;
  return `---\n${frontmatter}---\n\n${pathInfo}${skill.content}`;
}
```

这样 LLM 收到的内容会包含：

```markdown
---
name: example-skill
description: ...
---

> **Skill Directory**: `C:\Users\xxx\.desktop_tools\skills\example-skill`

# 原始 skill 内容...

请参考 ./docs/api.md 获取更多信息...
```

LLM 就能知道 `./docs/api.md` 的实际路径是 `C:\Users\xxx\.desktop_tools\skills\example-skill\docs\api.md`。

## 预期结果

- LLM 能正确解析 skill 中的相对路径
- 不影响原始 skill 文件内容
- 简单、透明、无需用户干预
