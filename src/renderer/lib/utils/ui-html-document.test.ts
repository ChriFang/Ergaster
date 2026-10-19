import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { UiHtmlSpec } from '../../../shared/ui-form';
import { buildUiHtmlDataUrl, buildUiHtmlDocument } from './ui-html-document';

function makeSpec(): UiHtmlSpec {
  return { version: 1, widgetId: 'ui-html-xyz', title: '投票', html: '<button onclick="agentSubmit({v:1})">投</button>' };
}

test('文档注入无出网 CSP', () => {
  const doc = buildUiHtmlDocument(makeSpec(), 'nonce-1');
  assert.ok(doc.includes("connect-src 'none'"));
  assert.ok(doc.includes("default-src 'none'"));
  assert.ok(doc.includes("form-action 'none'"));
});

test('文档嵌入原始 html 与桥接', () => {
  const doc = buildUiHtmlDocument(makeSpec(), 'nonce-1');
  assert.ok(doc.includes('<button onclick="agentSubmit({v:1})">投</button>'));
  assert.ok(doc.includes('window.agentSubmit'));
});

test('桥接携带 widgetId 与 nonce 供对账', () => {
  const doc = buildUiHtmlDocument(makeSpec(), 'nonce-abc');
  assert.ok(doc.includes('ui-html-xyz'));
  assert.ok(doc.includes('nonce-abc'));
});

test('桥接在文档头部、内容之前（垫片先于模型脚本安装）', () => {
  const doc = buildUiHtmlDocument(makeSpec(), 'nonce-1');
  const bridgeIndex = doc.indexOf('window.agentSubmit');
  const contentIndex = doc.indexOf('<button');
  assert.ok(bridgeIndex >= 0 && contentIndex > bridgeIndex);
});

test('桥接包含存储垫片与错误回传', () => {
  const doc = buildUiHtmlDocument(makeSpec(), 'nonce-1');
  assert.ok(doc.includes('localStorage'));
  assert.ok(doc.includes('"error"'));
  assert.ok(doc.includes('securitypolicyviolation'));
});

test('data URL 可解码回原文且带 mime', () => {
  const url = buildUiHtmlDataUrl(makeSpec(), 'nonce-1');
  assert.ok(url.startsWith('data:text/html;charset=utf-8,'));
  const html = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));
  assert.ok(html.includes('<button onclick="agentSubmit({v:1})">投</button>'));
  assert.ok(html.includes("connect-src 'none'"));
});
