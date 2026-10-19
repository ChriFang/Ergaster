export type AttachmentKind = 'image' | 'pdf' | 'word' | 'excel' | 'ppt' | 'text' | 'code';

export type AttachmentMeta = {
  id: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  createdAt: string;
  storedPath?: string;
};

/**
 * SVG 既是图片又是 XML 文本。部分模型供应商的 image_url 不支持 svg（会报
 * UnsupportedImageFormat），因此附件处理时把 svg 降级为按文本内容注入，而不是 base64 图片。
 */
export function isSvgAttachment(attachment: Pick<AttachmentMeta, 'mimeType' | 'originalName'>): boolean {
  return attachment.mimeType === 'image/svg+xml'
    || attachment.originalName.toLowerCase().endsWith('.svg');
}
