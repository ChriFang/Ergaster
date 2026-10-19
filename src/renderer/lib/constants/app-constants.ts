import type { AgentMessage } from '../../../shared/agent';

export const DEFAULT_VISIBLE_MESSAGES: AgentMessage[] = [
  {
    role: 'assistant',
    content: '你好，我是 AI 小助手。当前已经接入模型服务、多轮工具调用和 Windows 本地工具注册。',
  },
  {
    role: 'assistant',
    content: '你可以尝试发送：获取系统信息、读取一个文件、或创建一个文本草稿。',
  },
];

/** Code 模式的开场消息：说明能力边界与可直接照抄的提问方式。 */
export const DEFAULT_CODE_VISIBLE_MESSAGES: AgentMessage[] = [
  {
    role: 'assistant',
    content: '我是代码分析智能体，可以在当前工程内浏览目录、按文件名或正则检索、按行读取源码，帮你理清结构、定位实现和排查问题。',
  },
  {
    role: 'assistant',
    content: [
      '你可以这样问我：',
      '',
      '- 这个工程的整体结构和模块划分是怎样的？',
      '- 登录鉴权是在哪里实现的？',
      '- 谁调用了 `xxx` 这个函数？',
      '- 解释一下 `src/xxx.ts` 的作用和关键逻辑。',
      '',
      '输入 “/” 可以调用你配置的 Skill。默认只读，不会改动任何文件；需要我直接改代码时，请先点右上角的「允许修改」——开启后每次写入都会先给你看 diff 并等你确认，原文件也会自动备份。',
    ].join('\n'),
  },
];

