/** 把毫秒耗时格式化成中文短文案。用于工作流运行的实时耗时展示。 */
export function formatElapsed(elapsedMs: number) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) {
    return `${hours} 小时 ${String(minutes).padStart(2, '0')} 分`;
  }

  if (totalMinutes > 0) {
    return `${totalMinutes} 分 ${String(seconds).padStart(2, '0')} 秒`;
  }

  return `${seconds} 秒`;
}

/** token 数量在几十万量级也要能一眼看清，超过 1 万折算成 k。 */
export function formatTokenCount(count: number) {
  const safe = Math.max(0, Math.round(count));

  if (safe < 10_000) {
    return String(safe);
  }

  if (safe < 1_000_000) {
    return `${(safe / 1000).toFixed(1)}k`;
  }

  return `${(safe / 1_000_000).toFixed(2)}M`;
}
