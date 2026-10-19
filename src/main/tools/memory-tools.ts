import { z } from 'zod';
import type { ToolDefinition } from '../../shared/tools';
import { memoryService } from '../memory/memory-service';

/** 低风险、可静默自动执行的记忆工具（写入本地文件、无外部副作用）。memory_forget 为 medium，保留确认。 */
export const MEMORY_AUTO_APPROVED_TOOL_NAMES = ['memory_add', 'memory_search'];

const memoryKindSchema = z.enum(['profile', 'preference', 'project', 'fact']);

const memoryAddSchema = z.object({
  content: z.string().min(1).max(300),
  kind: memoryKindSchema.optional(),
  pinned: z.boolean().optional(),
});

const memorySearchSchema = z.object({
  query: z.string().min(1).max(200),
});

const memoryForgetSchema = z.object({
  id: z.string().min(1),
});

export const memoryTools: ToolDefinition<unknown>[] = [
  {
    name: 'memory_add',
    description: '把一条值得跨会话长期记住的、关于用户或其项目的稳定事实存入长期记忆。只存持久信息（身份/角色、长期偏好、进行中的项目、关键约束），不要存一次性的任务细节。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '一句话事实，简洁自包含' },
        kind: { type: 'string', enum: ['profile', 'preference', 'project', 'fact'], description: '记忆类型' },
        pinned: { type: 'boolean', description: '是否置顶（每轮必注入、不被淘汰）' },
      },
      required: ['content'],
      additionalProperties: false,
    },
    validator: memoryAddSchema,
    source: { type: 'system' },
    execute: async (args) => {
      const input = args as z.infer<typeof memoryAddSchema>;
      const result = await memoryService.add({ content: input.content, kind: input.kind, pinned: input.pinned });
      return result.ok
        ? { ok: true, content: `已记住：${result.data?.content ?? input.content}` }
        : { ok: false, content: result.error ?? '写入失败。', error: result.error };
    },
  },
  {
    name: 'memory_search',
    description: '按关键词检索该用户的长期记忆，返回最相关的若干条（含 id，可配合 memory_forget 使用）。',
    risk: 'low',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    validator: memorySearchSchema,
    source: { type: 'system' },
    execute: async (args) => {
      const input = args as z.infer<typeof memorySearchSchema>;
      const hits = memoryService.search(input.query);
      return {
        ok: true,
        content: JSON.stringify(hits.map((hit) => ({ id: hit.id, kind: hit.kind, content: hit.content, pinned: hit.pinned }))),
      };
    },
  },
  {
    name: 'memory_forget',
    description: '删除一条过时或错误的长期记忆（先用 memory_search 拿到 id）。',
    risk: 'medium',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '要删除的记忆 id' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    validator: memoryForgetSchema,
    source: { type: 'system' },
    execute: async (args) => {
      const input = args as z.infer<typeof memoryForgetSchema>;
      const result = await memoryService.forget(input.id);
      return result.ok
        ? { ok: true, content: '已删除该记忆。' }
        : { ok: false, content: result.error ?? '删除失败。', error: result.error };
    },
  },
];
