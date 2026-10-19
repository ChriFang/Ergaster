/**
 * 「路径引用」文本处理：拖入的文件若不属于可预提取的附件类型（视频、exe 等），
 * 把完整路径以文本形式插入输入区，模型看到路径后可调用系统工具（read_file、run_command 等）处理。
 * 主进程在返回这些路径前已调用 addRuntimeAllowedFile 放行工具访问。
 */

/** 含空白字符的路径加引号，避免输入区里的路径被空格截断、模型误读。 */
export function formatPathReference(targetPath: string): string {
  return /\s/.test(targetPath) ? `"${targetPath}"` : targetPath;
}

/** 把多条路径追加到当前输入文本末尾：各占一行，与原有内容空一行分隔；无路径时原样返回。 */
export function appendPathReferences(currentText: string, paths: string[]): string {
  if (paths.length === 0) {
    return currentText;
  }
  const block = paths.map(formatPathReference).join('\n');
  const trimmedEnd = currentText.replace(/\s+$/, '');
  return trimmedEnd ? `${trimmedEnd}\n${block}` : block;
}
