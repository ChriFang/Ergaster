# 修复 DeepSeek Reasoning Content 和 Skill 调用问题

## 问题分析

### 问题1: reasoning_content 缺失
当使用 DeepSeek 推理模型（如 `deepseek-reasoner`）时，API 返回的响应中包含 `reasoning_content` 字段。根据 DeepSeek API 规范，在多轮对话中，必须将上一轮返回的 `reasoning_content` 原样传回给 API，否则会报错：
```
The `reasoning_content` in the thinking mode must be passed back to the API.
```

### 问题2: Skill 调用错误
从日志看，模型调用了 `search_files` 而非用户配置的 skill。原因可能是：
1. Skill 描述存在编码问题（中文字符乱码）
2. 模型没有正确匹配用户意图与 skill 描述

## 解决方案

### 1. 修复 reasoning_content 支持

**修改文件**: `src/main/deepseek-client.ts`

需要修改以下内容：

```typescript
// 1. 扩展 DeepSeekApiMessage 类型，添加 reasoning_content 字段
export type DeepSeekApiMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: ToolCall[];
  reasoning_content?: string; // 新增：推理模型的思考内容
};

// 2. 扩展 ChatCompletionResponse 类型，解析 API 返回的 reasoning_content
type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      role?: 'assistant';
      content?: string | null;
      tool_calls?: ToolCall[];
      reasoning_content?: string; // 新增
    };
  }>;
  error?: {
    message?: string;
  };
};

// 3. 在返回结果中包含 reasoning_content
return {
  role: 'assistant' as const,
  content: message.content ?? null,
  reasoning_content: message.reasoning_content, // 新增
  ...(message.tool_calls && message.tool_calls.length > 0 ? { tool_calls: message.tool_calls } : {}),
};
```

### 2. 优化 Skill 描述处理（可选增强）

**修改文件**: `src/main/user-skills-service.ts`

在解析 YAML frontmatter 时，确保正确处理 UTF-8 编码。

### 3. 修复 Skill 文件编码问题

用户的 skill 文件存在编码问题，需要提醒用户重新保存为 UTF-8 编码。

## 受影响的文件

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `src/main/deepseek-client.ts` | 修改 | 添加 reasoning_content 支持 |
| `src/shared/agent.ts` | 修改 | 添加 reasoning_content 类型定义（可选，用于前端显示） |

## 边界条件

1. 普通模型（非推理模型）不返回 reasoning_content，代码需兼容处理
2. reasoning_content 可能为空字符串或 undefined
3. 多轮对话中，每轮的 reasoning_content 都需要保留并传回

## 数据流

```
用户请求 → API 返回含 reasoning_content 的响应 
→ 保存到 workingMessages（含 reasoning_content） 
→ 下次请求时发送 workingMessages（包含 reasoning_content）
→ API 正常处理
```

## 预期结果

1. 推理模型多轮对话正常工作
2. 不再出现 "reasoning_content must be passed back" 错误
3. Skill 调用正常（取决于描述是否清晰）
