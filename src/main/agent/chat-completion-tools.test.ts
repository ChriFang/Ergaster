import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import type { ToolDefinition, ToolSchemaShape } from '../../shared/tools';
import { toChatCompletionTool } from './chat-completion-tools';

function createTool(parameters: ToolSchemaShape): ToolDefinition<unknown> {
  return {
    name: 'test_tool',
    description: 'Test tool',
    risk: 'low',
    strict: true,
    parameters,
    validator: z.object({}),
    execute: async () => ({ ok: true, content: '' }),
  };
}

test('adds an empty required array to a parameterless tool schema', () => {
  const parameters: ToolSchemaShape = {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };

  const result = toChatCompletionTool(createTool(parameters));

  assert.deepEqual(result.function.parameters, {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  });
  assert.equal(result.function.strict, true);
  assert.equal(Object.hasOwn(parameters, 'required'), false);
});

test('preserves existing required fields and schema metadata', () => {
  const required = ['query'];
  const parameters: ToolSchemaShape = {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'integer' },
    },
    required,
    additionalProperties: false,
  };

  const result = toChatCompletionTool(createTool(parameters));

  assert.deepEqual(result.function.parameters, {
    ...parameters,
    required: ['query'],
  });
  assert.equal((result.function.parameters as ToolSchemaShape).required, required);
  assert.notEqual(result.function.parameters, parameters);
});

test('keeps required as an array in the OneAPI-compatible JSON payload', () => {
  const tool = toChatCompletionTool(createTool({
    type: 'object',
    properties: {},
    additionalProperties: false,
  }));
  const oneApiTool = {
    type: tool.type,
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    },
  };

  const serialized = JSON.parse(JSON.stringify(oneApiTool)) as typeof oneApiTool;

  assert.deepEqual(serialized.function.parameters.required, []);
  assert.equal(Object.hasOwn(serialized.function, 'strict'), false);
});
