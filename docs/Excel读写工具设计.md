# Excel 读写工具设计

## 1. 背景与现状

对话已允许选择 `.xls / .xlsx / .csv` 作为附件（`src/main/attachment-handlers.ts:27`），`AttachmentKind` 也定义了 `'excel'`（`src/shared/attachment.ts:1`），但整条链路缺少 Excel 专用处理，导致模型既不能可靠读取、也完全不能写出 Excel。

现状问题清单：

- **解析缺失**：附件预处理里 excel 落到 `readFile()` 的 UTF-8 分支（`src/main/agent-service.ts:83`）。`.xlsx` 本质是 ZIP 二进制，按 UTF-8 读出的是乱码；`.xls` 是老式二进制格式，同样不可读；`.csv` 勉强可用，但不处理 GBK 编码，且受 `readFile` 的 1MB 字节上限约束（`src/main/system-tools.ts:339`）。
- **无 Excel 依赖**：`package.json` 只有 `pdf-parse` / `mammoth` / `jszip`，没有任何电子表格解析库。
- **无写文件能力**：13 个系统工具（`src/main/tool-registry.ts:87` 起）中唯一的写操作是 `create_text_draft`，只能写 `.txt`。
- **模型拿不到附件路径**（关键阻塞点）：`buildAttachmentProcessingPayload` 拼给模型的附件段落只有 `originalName`，没有 `storedPath`（`src/main/agent-service.ts:85-89`）。而 `read_file` / `extract_pdf_text` / `extract_word_text` / `extract_ppt_text` 的描述都写着"使用当前消息中已明确给出的附件路径"——这个前提实际不成立。不修这一点，新增的 Excel 工具模型也无从调用。

## 2. 目标与非目标

**目标**

- 新增 Excel 解析能力，支持 `.xlsx` / `.xlsm` / `.csv` 的结构化读取（多 sheet、分页、单元格值归一化）。
- 新增 Excel 生成能力，允许模型在安全草稿目录产出 `.xlsx`。
- 修复附件路径透出，使已有 `extract_*` 系列与新增 Excel 工具真正可被模型调用。
- 附件预处理管线自动对 excel 附件走新解析器。

**非目标（本期不做）**

- 原地修改用户已有 Excel 文件（覆盖写不可逆，见 §9 风险）。
- 公式重算、图表、透视表、条件格式、合并单元格的完整还原。
- 老式二进制 `.xls`（与 `.doc` / `.ppt` 一致，明确报错引导转换）。

## 3. 依赖选型

**结论：引入 `exceljs`（固定版本 `4.4.0`）。**

- 纯 JS，无原生编译依赖，Electron 打包无 rebuild 成本。
- 读写双向，是本期唯一同时满足读和写的选项。
- 流式 API（`WorkbookReader`）可用于后续大文件优化。

已评估的备选：

- **复用现有 `jszip` 手写 OOXML 解析**：零新依赖，可仿照 `extractPptText`（`src/main/system-tools.ts:898`）的写法。但需自行处理共享字符串表（`sharedStrings.xml`）、日期序列号、公式缓存值、样式引用，且写入侧几乎要从零实现 OOXML 生成。只读需求才划算，与本期"要能写"的目标不匹配。
- **`xlsx`（SheetJS）社区版**：读取健壮性好，但写入功能在社区版受限，且发布渠道已迁出 npm registry，依赖管理成本高。

**构建注意**：`dev:main` 脚本 external 了 `pdf-parse` / `mammoth` / `jszip`，而生产 `build:main` 只有 `--external:electron`（`package.json:11,16`）。这意味着生产构建会把 `exceljs` 打进 bundle。落地时必须验证生产 `npm run build` 通过；若 esbuild 处理 `exceljs` 的依赖（`archiver` / `unzipper` 等）出错，则在两个脚本中统一追加 `--external:exceljs`，并确认打包产物包含 `node_modules/exceljs`。

## 4. 解析层设计

解析拆成两层，目的是让核心逻辑可测：`src/main/system-tools.ts` 依赖 `electron`，无法在 `node --test` 中直接加载。

- `src/main/excel-utils.ts`（新增，无 electron 依赖）：常量、CSV 解码与解析、单元格值归一化、Markdown 表渲染，以及 `readCsvBuffer` / `readXlsxBuffer` 两个纯函数（输入 Buffer，输出 `ToolResult`）。
- `src/main/system-tools.ts`：只保留 `extractExcelText` 这层薄封装——路径校验、文件大小校验、读盘、按扩展名分发、把 `path` 并入 `data`、写审计日志。

顺带把原先 system-tools 内部私有的 `truncateText` 提到 `src/main/tool-helpers.ts` 导出，供两处复用。

### 4.1 常量（`excel-utils.ts`）


```ts
const maxExcelExtractPreviewLength = 12000;   // 与 word/ppt 对齐
const maxExcelRowsPerSheet = 200;             // 单次返回行数上限
const maxExcelColumnsPerSheet = 50;           // 单次返回列数上限
const maxExcelFileSizeBytes = 10 * 1024 * 1024;
const excelWritableExtensions = new Set(['.xlsx']);
const excelReadableExtensions = new Set(['.xlsx', '.xlsm', '.csv']);
```

注意：读取限额以**行/列/字符数**为准，不复用 `readFile` 的 1MB 字节阈值——对 xlsx 而言字节数与 token 消耗不成比例。文件级仅保留 10MB 硬上限（与附件上传上限一致）。

### 4.2 `extractExcelText`（`system-tools.ts`）


```ts
export async function extractExcelText(
  filePath: string,
  options?: { sheetName?: string; startRow?: number; maxRows?: number },
  signal?: AbortSignal,
): Promise<ToolResult>
```

行为：

1. 路径校验 → 扩展名校验（`.xls` 返回"旧版 .xls 暂不支持，请转换为 .xlsx 或 CSV 后重试"）。
2. `.csv` 走独立分支：读 buffer，BOM 检测 + UTF-8 合法性探测，非法则按 GBK 回退解码（Node 内置 `TextDecoder('gbk')`），再按 RFC4180 切分（处理引号内逗号与换行）。
3. `.xlsx` / `.xlsm` 走 `exceljs`：`await import('exceljs')` 动态导入（与 `mammoth` / `jszip` 用法一致），`workbook.xlsx.load(buffer)`。
4. **未传 `sheetName` 时返回工作表概览**，不返回数据：每个 sheet 的名称、行数、列数、表头行。这是控制 token 的主要手段——模型先看目录，再按需取数据。
5. 传了 `sheetName` 时返回该表数据，从 `startRow`（1-based，默认 1）起最多 `maxRows` 行、`maxExcelColumnsPerSheet` 列，渲染为 Markdown 表格。
6. 单元格值归一化：日期转 ISO 字符串；公式取 `cell.result`（缓存值）并在 `data` 中标注该单元格为公式；富文本取纯文本；`null` / `undefined` 输出空串；超链接取显示文本。
7. 截断时用现有 `truncateText`，并在 `data` 中回传 `truncated` / `nextStartRow`，让模型知道还能继续翻页。

返回值：

```ts
{
  ok: true,
  content: string,        // sheet 概览 或 Markdown 表格
  data: {
    path, extractor: 'exceljs' | 'csv',
    sheets?: Array<{ name: string; rowCount: number; columnCount: number }>,
    sheetName?: string,
    startRow?: number, returnedRows?: number, totalRows?: number,
    nextStartRow?: number, truncated: boolean,
  }
}
```

空工作簿 / 空 sheet 返回 `ok: false`，错误文案参照 `extractWordText` 的"没有可提取的文本内容"。

### 4.3 写入：`buildExcelBuffer` + `createExcelDraft`

同样两层拆分：

```ts
// excel-utils.ts —— 纯函数，可测
export async function buildExcelBuffer(sheets: Array<{ name: string; rows: string[][] }>): Promise<Buffer>

// system-tools.ts —— 落盘
export async function createExcelDraft(fileName: string, sheets: ExcelDraftSheet[]): Promise<ToolResult>
```

`buildExcelBuffer` 的三条处理规则：

- **公式注入转义**：以 `=` `+` `-` `@` 制表符或回车开头的字符串加 `'` 前缀，避免生成的表格在用户机器上被 Excel 当公式执行（`escapeExcelFormulaInjection`）。
- **数值还原**：匹配 `^-?(0|[1-9]\d*)(\.\d+)?$` 的字符串写成数值，让生成的表格在 Excel 里能直接求和（`toExcelCellInput`）。这条规则同时保证 `-5` 走数值分支、不会被误加引号，而 `007` 这类带前导零的编号保持文本。
- **工作表名规整**：非法字符 `\ / * ? : [ ]` 替换为下划线、截断到 31 字符、空名回退 `SheetN`、重名自动加 `_2` 后缀（`sanitizeExcelSheetName`）。

首行加粗作表头。

`createExcelDraft` 复用 `createTextDraft`（`src/main/system-tools.ts:471`）的落盘约定——`getDraftDirectory()` + `mkdir` + `sanitizeFileName` + `resolveChildPath`，只把 `ensureTxtExtension` 换成新增的 `ensureXlsxExtension`。返回 `已创建 Excel 草稿：${fullPath}（N 个工作表，共 M 行）` 与 `data: { path, sheetCount, rowCount }`。

写入范围有两重防护：`sanitizeFileName` 先把路径分隔符替换掉（`../../evil` → `.._.._evil`），`resolveChildPath` 再兜底拦截逃出草稿目录的路径。

### 4.4 修改已有文件：`applyExcelCellUpdates` + `updateExcelCells`

```ts
// excel-utils.ts —— 纯函数，可测
export async function applyExcelCellUpdates(
  buffer: Buffer,
  sheetName: string,
  updates: Array<{ cell: string; value: string }>,
  signal?: AbortSignal,
): Promise<ApplyExcelCellUpdatesResult>

// system-tools.ts —— 读原文件 + 写副本
export async function updateExcelCells(
  filePath: string,
  sheetName: string,
  updates: ExcelCellUpdate[],
  outputFileName?: string,
  signal?: AbortSignal,
): Promise<ToolResult>
```

**绝不原地覆盖**：`updateExcelCells` 读取原文件、在内存中改、结果一律写入草稿目录的新文件，默认名 `${原文件名}-updated.xlsx`。原文件全程只读。因此 risk 保持 `medium` 而非 `high`，也不需要在确认摘要里警告覆盖。

前置校验（任一不通过即返回 `ok: false`，不做任何写入）：

- 单元格引用必须匹配 `^[A-Z]{1,3}[1-9]\d{0,6}$`（大小写不敏感，内部统一转大写）。
- 同一单元格不可重复出现，避免"后一条静默覆盖前一条"。
- 单次最多 200 个单元格（`maxExcelCellUpdates`）。
- 仅接受 `.xlsx`。`.xlsm` 拒绝——`workbook.xlsx.writeBuffer()` 无法保留宏，静默丢宏比报错更糟；`.csv` 拒绝并引导改用 `create_excel_draft` 重新生成。
- 工作表按名查找（大小写不敏感），`sheetName` 传空串时取第一个工作表；找不到时错误信息附带可用工作表列表。

新值走与写入侧相同的 `toExcelCellInput`，因此公式注入转义与数值还原两条规则同样生效。

返回内容包含逐单元格的 `旧值 → 新值` 清单，`data.changes` 里也有结构化版本，便于模型自查改对了没有。

`findWorksheetByName` 从 `readXlsxBuffer` 里抽出来，读、改两侧共用同一套工作表查找语义。



## 5. 工具注册（`src/main/tool-registry.ts`）

在 `registeredTools` 数组中，紧随 `extract_ppt_text`（第 204 行）之后插入。

### 5.1 Zod schema

```ts
const readExcelSchema = z.object({
  filePath: z.string().min(1).max(260),
  sheetName: z.string().max(120).optional(),
  startRow: z.number().int().min(1).max(1_000_000).optional(),
  maxRows: z.number().int().min(1).max(200).optional(),
});

const createExcelDraftSchema = z.object({
  fileName: z.string().min(1).max(120),
  sheets: z.array(z.object({
    name: z.string().min(1).max(31),                          // Excel sheet 名硬限制 31 字符
    rows: z.array(z.array(z.string().max(1000)).max(50)).min(1).max(2000),
  })).min(1).max(10),
});

const updateExcelCellsSchema = z.object({
  filePath: z.string().min(1).max(260),
  sheetName: z.string().max(120),                             // 空串表示取第一个工作表
  updates: z.array(z.object({
    cell: z.string().min(2).max(10),
    value: z.string().max(1000),
  })).min(1).max(200),
  outputFileName: z.string().max(120).optional(),
});
```

### 5.2 `read_excel`（risk: `low`）

描述文案需明确引导模型的两段式调用，否则模型会直接猜 sheet 名：

> 读取 Excel（.xlsx/.xlsm）或 CSV 文件内容。**首次调用请不要传 sheetName**，工具会返回工作表清单与行列数；确认目标工作表后再带上 sheetName 获取数据。数据量大时用 startRow/maxRows 分页。遇到 Excel/CSV 附件或本地路径时必须使用此工具，不要凭猜测编造数据。

`parameters` 中 `required: ['filePath']`，`additionalProperties: false`，`strict: true`。

`.strict` 模式下 OpenAI 兼容协议要求 `required` 覆盖全部字段，而本工具有可选参数。现有 `search_files`（`limit` 可选）已是同样情况，且 `toChatCompletionTool` 会把 `required` 规整为数组（`src/main/chat-completion-tools.ts:4`），故沿用既有做法，不额外处理。若实测某模型报 schema 错误，退化方案是把可选参数也列入 `required` 并允许 `null`。

### 5.3 `create_excel_draft`（risk: `medium`）

与 `create_text_draft` 同级风险，会触发用户确认弹窗（`src/main/confirmation-service.ts:25` 对 `low` 之外的风险一律走 IPC 确认）。描述说明了只能写入草稿目录、无法覆盖用户指定的任意路径文件，并引导"如需修改已有 Excel，先 `read_excel` 读出内容再用本工具生成新文件"。

### 5.4 `update_excel_cells`（risk: `medium`）

参数 `filePath` / `sheetName` / `updates` / `outputFileName`，其中 `updates` 是 `{ cell, value }` 数组。描述明确"结果一律另存为草稿目录中的新文件，原文件不会被改动"，并要求先用 `read_excel` 确认工作表名与单元格位置——否则模型会凭猜测填单元格坐标。

风险等级同为 `medium`：虽然是"修改"语义，但落盘目标是草稿目录的新文件，与 `create_excel_draft` 的实际影响面一致。

## 6. 附件预处理管线改造（`src/main/agent-service.ts`）

### 6.1 excel 分支接入

第 77-83 行的三元链补一层：

```ts
const result = attachment.kind === 'pdf'
  ? await extractPdfText(targetPath, signal)
  : attachment.kind === 'word'
    ? await extractWordText(targetPath, signal)
    : attachment.kind === 'ppt'
      ? await extractPptText(targetPath, signal)
      : attachment.kind === 'excel'
        ? await extractExcelText(targetPath, undefined, signal)
        : await readFile(targetPath, signal);
```

不传 `sheetName`，即首屏只给模型工作表概览，避免一次性灌入整张大表。

### 6.2 透出附件绝对路径（必做）

第 85-89 行的 section 拼接补入路径：

```ts
sections.push(
  result.ok
    ? `附件 ${index + 1}：${attachment.originalName}\n类型：${attachment.kind}\n绝对路径：${targetPath}\n提取结果：\n${result.content}`
    : `附件 ${index + 1}：${attachment.originalName}\n类型：${attachment.kind}\n绝对路径：${targetPath}\n读取失败：${result.error ?? '未知错误'}`,
);
```

同时在第 92-94 行的结尾提示中补一句：需要更多数据或指定工作表时，用上面的绝对路径调用相应工具。

此改动顺带修复了 `read_file` / `extract_pdf_text` / `extract_word_text` / `extract_ppt_text` 四个既有工具"描述承诺了路径但实际拿不到"的问题。

### 6.3 权限边界确认

无需新增白名单逻辑。`attachment-handlers.ts:227` 在持久化时已对来源路径调用 `addRuntimeAllowedFile`，而附件最终落盘的会话目录被 `getAllowedPaths()` 恒定纳入（`src/main/system-tools.ts:200-201`），因此 `assertWithinAllowedPaths` 对附件路径天然放行。草稿目录同样在白名单内。

## 7. 安全与限额

- **路径**：读写一律经 `assertWithinAllowedPaths` / `resolveChildPath`，不新开任何绕过通道。
- **写入范围**：仅草稿目录，文件名经 `sanitizeFileName`，不接受调用方给定的绝对路径。
- **ZIP 炸弹**：`.xlsx` 是 ZIP，解析前先 `fs.stat` 校验 10MB 上限；`exceljs` 解压后仍可能膨胀，故行/列限额在渲染层强制生效，不依赖文件大小。
- **公式注入**：写入侧对以 `=` `+` `-` `@` 制表符或回车开头的字符串单元格加前缀 `'`，避免生成的表格在用户机器上被 Excel 当公式执行（`escapeExcelFormulaInjection`）。纯数字字符串先走数值分支，因此 `-5` 不会被误加引号。这是本设计中唯一新增的安全处理点。
- **超时**：工具执行受 `tool-registry.ts` 既有 10s 超时约束，大文件解析可能触顶——见 §9。
- **审计**：无需额外工作，`appendToolAuditLog` 对所有工具统一记录。

## 8. 测试计划

新增 `src/main/excel-utils.test.ts`（27 个用例，全部通过），`test` 脚本改为同时构建运行两个测试文件：

```
"test": "esbuild src/main/chat-completion-tools.test.ts src/main/excel-utils.test.ts --bundle --platform=node --format=cjs --outdir=dist/test && node --test dist/test/chat-completion-tools.test.js dist/test/excel-utils.test.js"
```

读取侧已覆盖：

- 多 sheet 工作簿：不传 `sheetName` 只返回概览且不含数据行；传 `sheetName` 返回对应数据。
- 分页：`startRow` / `maxRows` 正确切片，`nextStartRow` 正确；越界 `startRow` 返回失败并说明总行数。
- 不存在的工作表：错误信息附带可用工作表列表。
- 单元格类型：日期转 ISO、公式取缓存值、公式错误值、超链接、富文本、空值。
- CSV：UTF-8 带 BOM、GBK 回退、引号内含逗号与换行、转义引号、空内容。
- 渲染：竖线转义、短行补齐；`normalizeExcelRange` 越界入参收敛。

写入侧已覆盖：

- round-trip：`buildExcelBuffer` 生成的文件能被 `readXlsxBuffer` 读回，表头、数值、被转义的公式串都符合预期。
- 公式注入：`=` `+` `-` `@` 前缀加引号，普通文本不受影响。
- 数值还原：`199` / `-5` / `12.5` 写成数值，`007` 保持文本。
- 工作表名：非法字符替换、31 字符截断、空名回退、重名去重为 `数据` / `数据_2`。
- 文件名：`../../evil` 经 `sanitizeFileName` + `ensureXlsxExtension` 变为 `.._.._evil.xlsx`，无法逃出草稿目录。

修改侧已覆盖：

- 改指定单元格后其余内容保留，返回逐单元格的 `旧值 → 新值`，单元格引用大小写不敏感。
- 新值同样走公式注入转义。
- `sheetName` 传空串时取第一个工作表。
- 拒绝：非法单元格引用、同一单元格重复指定、空修改列表、不存在的工作表（错误信息带可用列表）。

尚未覆盖（依赖 electron，需真实文件系统）：`.xls` / `.xlsm` / `.csv` 拒绝文案、非白名单路径拒绝、超 10MB 拒绝、草稿目录实际落盘、原文件未被改动。这些逻辑集中在 `extractExcelText` / `createExcelDraft` / `updateExcelCells` 的前置校验与落盘环节，目前靠人工验证。

验收命令：`npm run typecheck`、`npm run build`、`npm test`。

## 9. 分阶段实施

**阶段一（只读）— 已完成**

1. 加 `exceljs@4.4.0` 依赖，`npm run build` 通过，esbuild 可直接 bundle，无需追加 `--external`。
2. 实现 `excel-utils.ts` + `extractExcelText`。
3. 注册 `read_excel`。
4. 改 `agent-service.ts`：excel 分支 + 透出绝对路径。
5. 补 `excel-utils.test.ts`，typecheck / build / test 全通过。

**阶段二（写入）— 已完成**

6. 实现 `buildExcelBuffer`（公式注入转义 + 数值还原 + 工作表名规整）与 `createExcelDraft`，新增 `ensureXlsxExtension`。
7. 注册 `create_excel_draft`（risk `medium`）。
8. 补 round-trip 与安全用例，测试从 16 个增至 22 个。


**阶段三 — `update_excel_cells` 已完成，另两项暂缓**

9. 实现 `applyExcelCellUpdates` + `updateExcelCells`，注册 `update_excel_cells`（risk `medium`）。只写草稿目录副本，不支持原地覆盖。测试从 22 个增至 27 个。

暂缓的两项及理由：

- **exceljs 流式读取**：现有行/列限额已把单次解析量压在 200 行内，尚未观察到 10s 工具超时的实际案例。触发真实问题再做，避免为假设的性能问题引入流式改造的复杂度。
- **附件解析结果缓存**：同一文件被"附件预处理概览 + 工具二次读取"重复解析，目前每次解析在毫秒级，收益不明显。等出现大文件慢的实际反馈再做。

## 10. 风险与遗留问题

- **esbuild 打包 `exceljs`**：已验证通过，`dist/main/index.js` 从约 1.1mb 增至 2.4mb，无需 external 配置。
- **10s 工具超时**：万行级 xlsx 解析可能超时。阶段一先靠限额缓解，触发实际问题再上流式方案。
- **GBK 回退依赖 full ICU**：`TextDecoder('gbk')` 在缺少完整 ICU 的 Node 构建上会抛错，此时回退到 UTF-8 有损解码。Electron 官方构建自带 full ICU，正常不触发。
- **公式值依赖缓存**：`exceljs` 不重算公式，只能读 Excel 上次保存时写入的缓存值。若文件由脚本生成且未重算，公式单元格会是空值。此限制已写入工具描述，让模型据实说明而非编造。
- **`.xls` 用户体验**：直接拒绝可能让用户困惑。错误文案给出了明确的转换指引，与 `extractWordText` 对 `.doc` 的处理保持一致。
- **合并单元格**：`exceljs` 只在左上角单元格保留值，其余为空。表头含合并单元格的表格读出来会缺列名。本期不处理，仅在返回内容与 `data.mergedRangeCount` 中标注存在合并区域。

