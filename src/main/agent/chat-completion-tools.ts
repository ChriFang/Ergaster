import type { ChatCompletionTool } from '../../shared/agent';
import type { ToolDefinition } from '../../shared/tools';

export function toChatCompletionTool(tool: ToolDefinition<unknown>): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        ...tool.parameters,
        required: Array.isArray(tool.parameters.required) ? tool.parameters.required : [],
      },
      strict: tool.strict,
    },
  };
}
