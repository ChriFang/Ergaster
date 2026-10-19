# 将 Skills 目录添加到允许访问路径

## 问题分析

当 LLM 尝试使用 `open_path` 工具打开 skill 目录中的文件时，由于该目录不在允许访问列表中，操作被拒绝。

## 解决方案

修改 `getAllowedPaths()` 函数，将 skills 目录添加到默认允许路径中。

### 修改文件

**`src/main/system-tools.ts`**

```typescript
async function getAllowedPaths() {
  const config = await loadConfig();
  const configured = config.toolSettings?.allowedPaths ?? [];
  const fallback = [
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), 'Documents'),
    path.join(os.homedir(), '.desktop_tools', 'skills'), // 新增：skills 目录
  ];
  return (configured.length > 0 ? configured : fallback).map((value) => path.resolve(value));
}
```

同样，`getSearchRoots()` 也应添加 skills 目录，以便 `search_files` 工具可以搜索 skill 相关文件。

## 预期结果

- LLM 可以通过 `open_path` 打开 skill 目录中的文件
- LLM 可以通过 `search_files` 搜索 skill 目录中的文件
