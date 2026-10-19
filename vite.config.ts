import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * 仅在打包（build）时给主窗口注入 CSP meta。
 * - dev 不注入：Vite HMR 需要 inline 脚本与 ws 连接，注入会破坏热更新；
 * - 打包后走 file://，其 origin 为不透明的 null，'self' 匹配不可靠，故在 script/style/img 等处补 file: 方案源，
 *   既能加载应用自身产物，又拦截外部 http(s) 注入/外传与内联脚本（无 'unsafe-inline'/'unsafe-eval'）。
 * - frame-src 允许沙箱 iframe：docx 预览走 srcdoc（about:srcdoc），交互式 HTML widget（内联卡片与弹出窗口）
 *   走 data: URL；两者自身另有更严格的内联 CSP / sandbox，父窗口放行 data: 只是允许创建这类隔离 frame。
 */
function cspMetaPlugin(): Plugin {
  const csp = [
    "default-src 'self' file:",
    "script-src 'self' file:",
    "style-src 'self' 'unsafe-inline' file:",
    "img-src 'self' data: blob: file:",
    "font-src 'self' data: file:",
    "connect-src 'self'",
    "frame-src 'self' data: file:",
    "media-src 'self' data: blob: file:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  return {
    name: 'inject-csp-meta',
    apply: 'build',
    transformIndexHtml() {
      // head-prepend：CSP meta 必须排在 script/link 之前，否则前面的资源不受其约束
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react(), cspMetaPlugin()],
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: false,
  },
  server: {
    // dev 端口固定为 5273，需与 package.json dev:electron 的 wait-on / VITE_DEV_SERVER_URL 保持一致。
    port: 5273,
    strictPort: true,
  },
});
