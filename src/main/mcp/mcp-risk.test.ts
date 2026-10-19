import assert from 'node:assert/strict';
import test from 'node:test';
import { assessMcpToolRisk } from './mcp-risk';

test('assessMcpToolRisk 工具名命中破坏性词判 high', () => {
  assert.equal(assessMcpToolRisk({ toolName: 'delete_issue' }), 'high');
  assert.equal(assessMcpToolRisk({ toolName: 'removeNode' }), 'high');
  assert.equal(assessMcpToolRisk({ toolName: 'reset_cache' }), 'high');
});

test('assessMcpToolRisk 工具名命中变更类词判 medium', () => {
  assert.equal(assessMcpToolRisk({ toolName: 'create_draft' }), 'medium');
  assert.equal(assessMcpToolRisk({ toolName: 'send_message' }), 'medium');
  assert.equal(assessMcpToolRisk({ toolName: 'execute_python' }), 'medium');
});

test('assessMcpToolRisk 只读工具保持 low', () => {
  assert.equal(assessMcpToolRisk({ toolName: 'read_file' }), 'low');
  assert.equal(assessMcpToolRisk({ toolName: 'list_issues' }), 'low');
  assert.equal(assessMcpToolRisk({ toolName: 'search_papers', description: 'Search arXiv papers by keyword.' }), 'low');
});

test('assessMcpToolRisk 描述命中风险词时升级，工具名优先级更高', () => {
  // 名字只读、描述提到删除 → high
  assert.equal(assessMcpToolRisk({ toolName: 'get_queue', description: 'Fetch queue and delete expired jobs.' }), 'high');
  // 名字只读、描述提到写入 → medium
  assert.equal(assessMcpToolRisk({ toolName: 'get_doc', description: 'Get document and save a local cache.' }), 'medium');
  // 名字是变更类、描述只读 → 仍 medium（以名字为准，不降级）
  assert.equal(assessMcpToolRisk({ toolName: 'update_status', description: 'Read only.' }), 'medium');
});

test('assessMcpToolRisk 词边界避免子串误伤', () => {
  assert.equal(assessMcpToolRisk({ toolName: 'get_information' }), 'low');
  assert.equal(assessMcpToolRisk({ toolName: 'list_presets' }), 'low');
  assert.equal(assessMcpToolRisk({ toolName: 'history_query' }), 'low');
});
