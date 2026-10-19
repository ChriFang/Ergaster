import type { UiHtmlSpec } from '../../../shared/ui-form';

/**
 * 交互式 HTML widget 的沙箱文档包装（纯函数，可单测）。
 *
 * 安全边界:
 * - 外层 iframe 用 sandbox="allow-scripts allow-forms"（绝不加 allow-same-origin），且以 data: URL 承载：
 *   allow-forms 不能省——缺它时按 HTML 规范「提交表单」算法会在 sandboxed forms 标志处直接 return，
 *   <form> 的 submit 事件不会触发，桥接脚本捕获不到提交（这是「表单提交无响应」的根因）。
 *   放开表单提交并不削弱边界：无同源、无网络，且文档自身 CSP 的 form-action 'none' 禁止一切导航。
 *   data: frame 拥有独立的空策略容器，不继承主窗口 CSP（srcdoc 会继承，打包后父窗口
 *   script-src 无 unsafe-inline 会拦掉模型的内联脚本）；自身再注入下面的严格 CSP。
 * - CSP 里 connect-src 'none' 让内容无任何出网能力，数据只能经 postMessage 走宿主校验的口子。
 * - 沙箱是 opaque origin，localStorage/document.cookie 访问会直接抛错——桥接脚本在内容之前
 *   注入内存垫片，避免游戏类脚本因存档读写崩溃。
 * - 桥接脚本暴露 window.agentSubmit(data)，拦截 form 提交，回传带 widgetId + nonce 供宿主对账；
 *   并把脚本错误 / CSP 违规回传宿主展示，便于排查模型产出的 HTML 问题。
 */
const SANDBOX_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const THEME_CSS = [
  'html,body{margin:0;padding:12px;background:transparent;color:#e5e9f0;',
  "font:13px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;box-sizing:border-box}",
  '*,*::before,*::after{box-sizing:inherit}',
  'button{cursor:pointer;font:inherit}',
  'input,select,textarea{font:inherit}',
].join('');

function buildBridgeScript(spec: UiHtmlSpec, nonce: string): string {
  const cfg = JSON.stringify({ widgetId: spec.widgetId, nonce });
  return [
    '(function(){',
    `  var CFG=${cfg};var submitted=false;`,
    "  function post(type,extra){try{parent.postMessage(Object.assign({__agentUi:true,widgetId:CFG.widgetId,nonce:CFG.nonce,type:type},extra||{}),'*');}catch(e){}}",
    // 沙箱 iframe 是 opaque origin，访问 localStorage/cookie 会抛 SecurityError；
    // 用内存垫片顶替，游戏存高分/进度这类调用不再崩掉整个脚本
    '  function makeStorage(){var m={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null;},setItem:function(k,v){m[k]=String(v);},removeItem:function(k){delete m[k];},clear:function(){m={};},key:function(i){var ks=Object.keys(m);return i>=0&&i<ks.length?ks[i]:null;},get length(){return Object.keys(m).length;}};}',
    '  try{Object.defineProperty(window,"localStorage",{value:makeStorage(),configurable:true});}catch(e){}',
    '  try{Object.defineProperty(window,"sessionStorage",{value:makeStorage(),configurable:true});}catch(e){}',
    '  try{Object.defineProperty(document,"cookie",{get:function(){return "";},set:function(){},configurable:true});}catch(e){}',
    // 错误回传：脚本异常 / 未处理拒绝 / CSP 违规都推给宿主展示
    '  window.addEventListener("error",function(ev){post("error",{message:String((ev&&ev.message)||"脚本错误")});});',
    '  window.addEventListener("unhandledrejection",function(ev){var r=ev&&ev.reason;post("error",{message:"未处理的 Promise 拒绝: "+String((r&&r.message)||r)});});',
    '  document.addEventListener("securitypolicyviolation",function(ev){post("error",{message:"被内容安全策略拦截: "+String(ev.violatedDirective||"")+" "+String(ev.blockedURL||"")});});',
    '  window.agentSubmit=function(data){if(window.__agentUiSubmitted)return;window.__agentUiSubmitted=true;post("submit",{data:(data==null?{}:data)});};',
    '  document.addEventListener("submit",function(ev){ev.preventDefault();if(window.__agentUiSubmitted)return;var out={};try{new FormData(ev.target).forEach(function(v,k){out[k]=typeof v==="string"?v:String(v);});}catch(e){}window.agentSubmit(out);},true);',
    '  var lastHeight=0;',
    '  function sendHeight(){var h=Math.ceil(document.documentElement.scrollHeight);if(h!==lastHeight){lastHeight=h;post("resize",{height:h});}}',
    '  if(typeof ResizeObserver!=="undefined"){new ResizeObserver(sendHeight).observe(document.documentElement);}',
    '  window.addEventListener("load",sendHeight);',
    '  setTimeout(sendHeight,50);',
    '})();',
  ].join('\n');
}

/** 把模型产出的 HTML 片段包成带 CSP、主题与桥接脚本的完整沙箱文档。nonce 由 renderer 每次挂载生成。 */
export function buildUiHtmlDocument(spec: UiHtmlSpec, nonce: string): string {
  return [
    '<!doctype html>',
    '<html><head>',
    '<meta charset="utf-8" />',
    `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}" />`,
    `<style>${THEME_CSS}</style>`,
    `<script>${buildBridgeScript(spec, nonce)}</script>`,
    '</head><body>',
    spec.html,
    '</body></html>',
  ].join('\n');
}

/**
 * 用 data: URL 承载沙箱文档。
 * 不用 srcdoc：srcdoc 会继承主窗口 CSP，打包版（script-src 无 unsafe-inline）会拦掉 iframe 内联脚本；
 * data: frame 是独立空策略容器，只受文档自身 CSP 约束。
 */
export function buildUiHtmlDataUrl(spec: UiHtmlSpec, nonce: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(buildUiHtmlDocument(spec, nonce))}`;
}
