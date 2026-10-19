import { defaultUrlTransform } from 'react-markdown';

const httpUrlPattern = /^https?:\/\//i;
const fileUrlPattern = /^file:\/\//i;
const windowsAbsolutePathPattern = /^[a-zA-Z]:[\\/]/;
const uncPathPattern = /^\\\\/;

function decodeUrlSafely(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * 把 markdown 链接地址还原成本地文件路径；不是本地路径时返回空串。
 *
 * 模型经常把工具写出的草稿路径包装成 markdown 链接，例如
 * `[打开「大图URL.txt」](C:\Users\...\大图URL.txt)`。
 *
 * 关键点：mdast-util-to-hast 会对链接地址做 normalizeUri 百分号编码，反斜杠变成
 * %5C、中文变成 %E5%A4%A7 之类，因此必须先解码再判断路径形态，否则任何
 * 「以盘符开头」的匹配都会失败。具体编码结果见 message-link.test.ts。
 */
export function toLocalFilePath(url: string) {
  const trimmed = url.trim();

  if (!trimmed || httpUrlPattern.test(trimmed)) {
    return '';
  }

  if (fileUrlPattern.test(trimmed)) {
    try {
      const { pathname, hostname } = new URL(trimmed);
      const decodedPath = decodeUrlSafely(pathname);

      if (hostname) {
        return `\\\\${hostname}${decodedPath.replace(/\//g, '\\')}`;
      }

      // file:///C:/foo → /C:/foo，需要去掉前导斜杠
      return decodedPath.replace(/^\/(?=[a-zA-Z]:)/, '');
    } catch {
      return '';
    }
  }

  const decoded = decodeUrlSafely(trimmed);

  if (windowsAbsolutePathPattern.test(decoded) || uncPathPattern.test(decoded) || decoded.startsWith('/')) {
    return decoded;
  }

  return '';
}

/**
 * react-markdown 的 defaultUrlTransform 只放行 http/https/mailto 等协议，会把
 * `C:\...`（协议被当成 "c"）和 `file://...` 清成空串，导致 href 为空、点击无从下手。
 * 这里放行本地文件路径，其余仍交给默认实现拦截 javascript: 之类。
 */
export function messageUrlTransform(url: string) {
  return toLocalFilePath(url) ? url : defaultUrlTransform(url);
}
