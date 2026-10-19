import type { CallToolResult as SdkCallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type McpResultContent = {
  text: string;
  /** image 块转成的 data URL 列表，随 ToolResult.images 走多模态内容块。 */
  images: string[];
};

/**
 * 把 MCP 工具结果的内容块拆成文本与图片。
 *
 * image 块（如 Blender MCP 的视口截图）绝不能再 JSON.stringify 成文本：
 * 一张截图的 base64 就是几十万 token，会直接把 prompt 顶爆
 * （上游报 "Prompt exceeds max length"）。这里转成 data URL 交给
 * ToolResult.images，由 toToolMessage 以 image_url 内容块发给模型。
 */
export function extractMcpResultContent(result: { content?: SdkCallToolResult['content'] }): McpResultContent {
  const blocks = Array.isArray(result.content) ? result.content : [];
  const textParts: string[] = [];
  const images: string[] = [];
  const otherBlocks: unknown[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== 'object') {
      otherBlocks.push(block);
      continue;
    }

    const record = block as Record<string, unknown>;
    if (record.type === 'text' && typeof record.text === 'string') {
      textParts.push(record.text);
    } else if (record.type === 'image' && typeof record.data === 'string' && record.data.length > 0) {
      const mimeType = typeof record.mimeType === 'string' && record.mimeType.trim() ? record.mimeType.trim() : 'image/png';
      images.push(`data:${mimeType};base64,${record.data}`);
    } else {
      // resource 等其余块保持 JSON 序列化，避免丢信息
      otherBlocks.push(record);
    }
  }

  let text = textParts.join('\n');
  if (otherBlocks.length > 0) {
    const otherText = JSON.stringify(otherBlocks);
    text = text ? `${text}\n${otherText}` : otherText;
  }
  if (images.length > 0) {
    const note = `[该工具返回了 ${images.length} 张图片，已作为图片内容附带]`;
    text = text ? `${text}\n${note}` : note;
  }

  return { text, images };
}
