/**
 * 应用品牌图形：与 assets/icon.ico 同源（images/icons-bot.svg）。
 * 必须内联渲染——currentColor 要跟随容器配色，走 <img> 会解析成黑色；
 * viewBox 与图标生成时一致（收紧取景），保证和任务栏图标视觉大小一致。
 */
export function BotMarkIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="3.9 3.9 78.1 78.1" fill="none">
      <defs>
        <mask id="bot-brand-notch" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect width="100" height="100" fill="#fff" />
          <path
            d="M71 51.5C71 55.5 75 61 80.5 61C75 61 71 66.5 71 71C71 66.5 67 61 61.5 61C67 61 71 55.5 71 51.5Z"
            fill="#000"
            stroke="#000"
            strokeWidth={5}
            strokeLinejoin="round"
          />
        </mask>
      </defs>
      {/* 头部轮廓：右下角被 mask 挖出缺口 */}
      <rect x="8" y="18" width="68" height="48" rx="16" stroke="currentColor" strokeWidth={5} mask="url(#bot-brand-notch)" />
      {/* 眼睛 */}
      <rect x="25" y="33" width="10" height="11" rx="3" fill="currentColor" />
      <rect x="47" y="33" width="10" height="11" rx="3" fill="currentColor" />
      {/* 嘴巴 */}
      <rect x="33" y="52" width="18" height="7" rx="3.5" fill="currentColor" />
      {/* 星芒：嵌在右下角缺口中 */}
      <path
        fill="currentColor"
        d="M71 51.5C71 55.5 75 61 80.5 61C75 61 71 66.5 71 71C71 66.5 67 61 61.5 61C67 61 71 55.5 71 51.5Z"
      />
    </svg>
  );
}
