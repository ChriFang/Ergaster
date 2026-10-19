# 添加 read_file 工具

## 需求分析

当前系统缺少读取文件内容的工具。当 LLM 需要读取 skill 目录下的参考文件时，只能调用 `open_path` 在外部打开文件，无法获取文件内容进行处理。

## 解决方案

添加 `read_file` 工具，用于读取文本文件内容并返回给 LLM。

### 功能设计

1. **工具名称**: `read_file`
2. **参数**: `filePath` (字符串，文件路径)
3. **安全限制**: 只能读取允许访问目录内的文件
4. **返回**: 文件内容（文本）
5. **限制**: 
   - 文件大小限制（如 1MB）
   - 仅支持文本文件
   - 路径必须在允许访问目录内

### 修改文件

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `src/main/system-tools.ts` | 修改 | 添加 `readFile` 函数实现 |
| `src/main/tool-registry.ts` | 修改 | 注册 `read_file` 工具 |

### 实现细节

**system-tools.ts**:
```typescript
export async function readFile(filePath: string, signal?: AbortSignal): Promise<ToolResult> {
  // 1. 验证路径在允许访问目录内
  const resolvedPath = await assertWithinAllowedPaths(filePath);
  
  // 2. 检查文件是否存在
  // 3. 检查文件大小（限制 1MB）
  // 4. 读取文件内容
  // 5. 返回内容给 LLM
}
```

**tool-registry.ts**:
```typescript
{
  name: 'read_file',
  description: '读取允许目录内的文本文件内容。',
  risk: 'low',
  // ...
}
```

## 边界条件

1. 文件不存在 → 返回错误
2. 文件过大 → 返回错误或截断
3. 非文本文件 → 返回错误或提示
4. 路径不在允许目录 → 返回权限错误

## 预期结果

LLM 可以通过 `read_file` 工具读取 skill 目录下的参考文件内容，例如：
```
read_file({"filePath": "C:\\Users\\xxx\\.desktop_tools\\skills\\xxx\\references\\api.md"})
```
