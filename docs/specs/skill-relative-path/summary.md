# Skill 相对路径支持 - 总结

## 完成的任务

### Task 1: 修改 user-skills-service.ts 注入目录路径
修改了 `buildFullMarkdown` 方法，在返回给 LLM 的 skill 内容开头注入目录路径信息：

```typescript
buildFullMarkdown(skill: UserSkillDefinition): string {
  const frontmatter = stringifyYaml(skill.metadata as Record<string, unknown>);
  const pathInfo = `> **Skill Directory**: \`${skill.directoryPath}\`\n\n`;
  return `---\n${frontmatter}---\n\n${pathInfo}${skill.content}`;
}
```

### Task 2: 构建验证
- TypeScript 编译通过
- npm run build 构建成功

## 效果

现在 LLM 收到的 skill 内容会包含目录路径：

```markdown
---
name: example-skill
description: ...
---

> **Skill Directory**: `C:\Users\xxx\.desktop_tools\skills\example-skill`

# 原始 skill 内容...
```

LLM 可以根据这个路径信息正确解析 skill 中的相对路径引用。
