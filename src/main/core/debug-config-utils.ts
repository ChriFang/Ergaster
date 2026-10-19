/**
 * test.ini 调试开关相关的零依赖纯函数。
 * 拆出纯逻辑是为了能在无 Electron 的 node --test 环境中单测（先例：agent/title-text-utils.ts）。
 */

export type IniConfig = Record<string, Record<string, string>>;

/**
 * 通用 ini 解析：返回「节名 → 键值表」。
 * - 节名与 key 统一小写（查询不区分大小写），value 仅去首尾空白、保留原大小写（如 env=Prod）
 * - 去 BOM、按 \r?\n 分行、容忍 `key = value` 空格、忽略 `;`/`#` 注释行
 * - 重复 key 后者覆盖；节外出现的 key（首个节头之前）直接忽略；无法解析的行跳过
 */
export function parseIni(content: string): IniConfig {
  const result: IniConfig = {};
  let currentSection: Record<string, string> | null = null;

  for (const rawLine of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) {
      continue;
    }

    const sectionMatch = /^\[(.+)\]$/.exec(line);
    if (sectionMatch) {
      const section = sectionMatch[1].trim().toLowerCase();
      currentSection = (result[section] ??= {});
      continue;
    }

    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0 || !currentSection) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim().toLowerCase();
    if (key) {
      currentSection[key] = line.slice(eqIndex + 1).trim();
    }
  }

  return result;
}

/** 开启条件：[Config] 节内 dumpReq 的值（去空白后）严格等于 '1'。 */
export function isDumpRequestEnabled(ini: IniConfig | null): boolean {
  return ini?.config?.dumpreq === '1';
}

/** 本机时区时间戳：2026-09-28 14:46:41.650 +08:00（带偏移量，可与任何本机时间直接对照）。 */
export function formatLocalTimestamp(date: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offset = `${sign}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`;

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)} ${offset}`
  );
}

export type DumpRequestEntryInput = {
  seq: number;
  timestamp: string;
  retryLabel: string;
  url: string;
  headers: Record<string, string>;
  body: string;
};

/** 生成一条完整请求块（含末尾换行），Authorization 头脱敏为 `Bearer ***`。 */
export function formatDumpRequestEntry(input: DumpRequestEntryInput): string {
  const headerLines = Object.entries(input.headers).map(([name, value]) => {
    const sanitized = name.toLowerCase() === 'authorization' ? 'Bearer ***' : value;
    return `${name}: ${sanitized}`;
  });

  return [
    `=== dump #${input.seq} [${input.timestamp}] ${input.retryLabel} ===`,
    `POST ${input.url}`,
    ...headerLines,
    '--- body ---',
    input.body,
    '',
  ].join('\n');
}
