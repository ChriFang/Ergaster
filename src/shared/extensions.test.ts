import assert from 'node:assert/strict';
import test from 'node:test';
import { EXTENSION_IDS } from './extensions';

/**
 * 扩展 id 事实源的基本约束。main 的 capabilityModules 与 renderer 的 extension-catalog
 * 都从 EXTENSION_IDS 取 id，这里保证事实源本身无重复、非空标识。
 * （两端目录与事实源的一致性断言放在各自可加载的测试里；此处守住源头。）
 */
test('EXTENSION_IDS 无重复且均为非空小写标识', () => {
  const ids = [...EXTENSION_IDS];
  assert.equal(new Set(ids).size, ids.length, '存在重复的扩展 id');
  for (const id of ids) {
    assert.match(id, /^[a-z][a-z0-9-]*$/, `扩展 id 不合法：${id}`);
  }
});

test('mail 是已登记的扩展 id', () => {
  assert.ok((EXTENSION_IDS as readonly string[]).includes('mail'));
});
