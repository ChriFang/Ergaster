import { ArrowUp, Brain, ChevronDown, Pencil, Plus, RefreshCw, Sparkles, Square, SquareTerminal, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  type SyntheticEvent,
} from 'react';
import type { AttachmentKind, AttachmentMeta } from '../../../shared/attachment';
import { getModelEffortOptions, type ReasoningEffort } from '../../../shared/config';
import type { PendingAttachment } from '../../lib/hooks/use-chat-session';
import { desktopAppClient } from '../../lib/desktop/desktop-app-client';
import { appendPathReferences } from './path-reference';
import { applySlashSelection, filterSlashCandidates, getSlashTriggerState, groupSlashCandidates } from '../../lib/utils/slash-command';
import type { SlashSkillOption, SlashTriggerState } from '../../lib/utils/slash-command';
import { readRecentSlashNames, recordRecentSlashName } from '../../lib/utils/slash-recent';
import { readInputHistory } from '../../lib/utils/input-history';

const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
/** "/" 菜单每个分区折叠时最多显示的条数（仅在无查询词、纯浏览时生效）。 */
const SLASH_SECTION_COLLAPSE_LIMIT = 5;
/** 「最近使用」分区折叠时显示的条数：存 6 条（见 slash-recent），浏览态只露 3 条。 */
const SLASH_RECENT_COLLAPSE_LIMIT = 3;

const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
};

type ComposerProps = {
  value: string;
  attachments: PendingAttachment[];
  onAttachmentsChange: (attachments: PendingAttachment[]) => void;
  isRunning: boolean;
  thinkingModeEnabled: boolean;
  availableModels: string[];
  selectedModel: string;
  modelsLoading: boolean;
  modelsError: string | null;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onThinkingModeChange: (value: boolean) => void;
  reasoningEffortByModel: Record<string, ReasoningEffort>;
  onModelReasoningEffortChange: (model: string, effort: ReasoningEffort) => void;
  onModelChange: (model: string) => void;
  onRefreshModels: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  /** 当前会话 id：用于按会话读取输入记录（↑/↓ 调起）。为空则不启用历史导航。 */
  conversationId?: string | null;
  placeholder?: string;
  /** 可用的 skill 候选。不传或为空数组时不启用 "/" 指令菜单（工作流侧就不传）。 */
  skills?: SlashSkillOption[];
  /** 是否隐藏附件入口。工作流侧不接收附件，显示出来点了也没用。 */
  hideAttachmentButton?: boolean;
};

function inferAttachmentKind(fileName: string, mimeType: string): AttachmentKind | null {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  const dotExtension = extension ? `.${extension}` : '';
  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  if (mimeType === 'application/pdf' || dotExtension === '.pdf') {
    return 'pdf';
  }
  if (['.doc', '.docx'].includes(dotExtension) || mimeType.includes('wordprocessingml') || mimeType === 'application/msword') {
    return 'word';
  }
  if (['.xls', '.xlsx', '.csv'].includes(dotExtension) || mimeType.includes('spreadsheetml') || mimeType === 'application/vnd.ms-excel' || mimeType === 'text/csv') {
    return 'excel';
  }
  if (['.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.json', '.xml', '.html', '.css', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.kts', '.sh', '.bat', '.ps1', '.sql'].includes(dotExtension)) {
    return 'code';
  }
  if (['.txt', '.md', '.log', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env'].includes(dotExtension) || mimeType.startsWith('text/')) {
    return 'text';
  }
  return null;
}

function formatAttachmentSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentIcon({ kind }: { kind: AttachmentKind }) {
  const label = kind === 'pdf' ? 'PDF' : kind === 'word' ? 'DOC' : kind === 'excel' ? 'XLS' : kind === 'code' ? '</>' : 'TXT';
  return <span className="composer-attachment-kind">{label}</span>;
}

function buildPastedImageMeta(file: File, size: number): AttachmentMeta | null {
  const fileName = file.name || 'pasted-image.png';
  const mimeType = file.type || 'image/png';
  const kind = inferAttachmentKind(fileName, mimeType);
  if (!kind) {
    return null;
  }

  return {
    id: crypto.randomUUID(),
    fileName,
    originalName: fileName,
    mimeType,
    size,
    kind,
    createdAt: new Date().toISOString(),
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function hasFilesPayload(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export function Composer({
  value,
  attachments,
  onAttachmentsChange,
  isRunning,
  thinkingModeEnabled,
  availableModels,
  selectedModel,
  modelsLoading,
  modelsError,
  onChange,
  onSubmit,
  onCancel,
  onThinkingModeChange,
  reasoningEffortByModel,
  onModelReasoningEffortChange,
  onModelChange,
  onRefreshModels,
  onKeyDown,
  inputRef,
  conversationId,
  placeholder = '/调起指令，↑↓切换输入历史',
  skills,
  hideAttachmentButton = false,
}: ComposerProps) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [effortMenuModel, setEffortMenuModel] = useState<string | null>(null);
  const [effortMenuPos, setEffortMenuPos] = useState<{ bottom: number; right: number } | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [slashTrigger, setSlashTrigger] = useState<SlashTriggerState | null>(null);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  // 「最近使用」分区数据：选用某项后置顶记录，持久化在 localStorage
  const [recentSlashNames, setRecentSlashNames] = useState<string[]>(() => readRecentSlashNames());
  // 被展开的分区 key（点了 "Show N more"）。菜单关闭时重置
  const [expandedSlashGroups, setExpandedSlashGroups] = useState<Set<string>>(() => new Set());
  // 被主动收起的那个 "/" 的下标。用户点回输入框或按 Esc 表示"这个 / 只是普通字符"，
  // 记住下标而不是简单清空，否则光标一动就会重新弹出来。换一个新的 "/" 才重新触发。
  const [dismissedSlashIndex, setDismissedSlashIndex] = useState<number | null>(null);
  const dragCounterRef = useRef(0);
  const modelDropdownRef = useRef<HTMLDivElement | null>(null);
  const slashMenuRef = useRef<HTMLDivElement | null>(null);
  const internalEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const editorRef = inputRef ?? internalEditorRef;
  // 输入记录（↑/↓ 调起）的导航态：index=null 表示未在浏览历史；draft 暂存进入浏览前的草稿；snapshot 是进入时定格的历史
  const historyIndexRef = useRef<number | null>(null);
  const historyDraftRef = useRef<string>('');
  const historySnapshotRef = useRef<string[]>([]);
  // 切换会话时退出历史浏览，避免拿旧会话的快照/草稿
  useEffect(() => {
    historyIndexRef.current = null;
  }, [conversationId]);
  const modelListboxId = useId();
  const slashListboxId = useId();
  const slashEnabled = (skills?.length ?? 0) > 0 && !isRunning;
  const slashSuppressed = slashTrigger !== null && slashTrigger.startIndex === dismissedSlashIndex;
  const slashMatches = useMemo(
    () => (slashEnabled && slashTrigger && !slashSuppressed ? filterSlashCandidates(skills ?? [], slashTrigger.query) : []),
    [slashEnabled, skills, slashSuppressed, slashTrigger],
  );
  const slashMenuOpen = slashMatches.length > 0;
  // 分组渲染模型：最近使用 / 命令 / Skills；仅无查询词时按分区折叠，键盘导航按可见项的扁平序号
  const slashRenderModel = useMemo(() => {
    const groups = groupSlashCandidates(slashMatches, recentSlashNames);
    const collapse = (slashTrigger?.query ?? '').trim().length === 0;
    let flatIndex = 0;
    const renderedGroups = groups.map((group) => {
      const limit = group.key === 'recent' ? SLASH_RECENT_COLLAPSE_LIMIT : SLASH_SECTION_COLLAPSE_LIMIT;
      const expanded = !collapse || expandedSlashGroups.has(group.key);
      const shown = expanded ? group.items : group.items.slice(0, limit);
      const items = shown.map((item) => ({ item, index: flatIndex++ }));
      const hiddenCount = expanded ? 0 : Math.max(0, group.items.length - limit);
      return { key: group.key, title: group.title, items, hiddenCount };
    });
    const flatItems = renderedGroups.flatMap((group) => group.items.map((entry) => entry.item));
    return { groups: renderedGroups, flatItems };
  }, [slashMatches, recentSlashNames, expandedSlashGroups, slashTrigger]);
  const slashVisibleItems = slashRenderModel.flatItems;
  const hasModels = availableModels.length > 0;
  const selectValue = availableModels.includes(selectedModel) ? selectedModel : (availableModels[0] ?? '');
  const modelTriggerLabel = hasModels ? selectValue : (modelsLoading ? '获取模型中…' : '未获取到模型');
  // 没有模型时也要允许打开下拉，否则收在菜单里的"刷新"就点不到了
  const modelSelectDisabled = isRunning;
  const modelSelectTitle = modelsError ?? (hasModels ? '选择模型' : '未获取到模型，请在设置中检查 API Key 与 Base URL');
  const canSubmit = Boolean(value.trim()) || attachments.length > 0;
  const selectedModelOption = useMemo(() => availableModels.find((model) => model === selectValue) ?? null, [availableModels, selectValue]);

  useEffect(() => {
    if (!modelMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!modelDropdownRef.current?.contains(event.target as Node)) {
        setModelMenuOpen(false);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setModelMenuOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [modelMenuOpen]);

  useEffect(() => {
    if (modelSelectDisabled && modelMenuOpen) {
      setModelMenuOpen(false);
    }
  }, [modelMenuOpen, modelSelectDisabled]);

  useEffect(() => {
    if (!modelMenuOpen) {
      setEffortMenuModel(null);
      setEffortMenuPos(null);
    }
  }, [modelMenuOpen]);

  // 候选变化后把高亮收回有效范围，避免过滤后指向不存在的项
  useEffect(() => {
    setSlashActiveIndex((current) => (current < slashVisibleItems.length ? current : 0));
  }, [slashVisibleItems.length]);

  // 菜单关闭后重置分区展开态，下次打开回到折叠的浏览视图
  useEffect(() => {
    if (!slashMenuOpen) {
      setExpandedSlashGroups((prev) => (prev.size === 0 ? prev : new Set()));
    }
  }, [slashMenuOpen]);

  useEffect(() => {
    if (!slashMenuOpen) {
      return;
    }

    // 菜单以外的任何点击都算"不选了"，包括再次点输入框本身
    function handlePointerDown(event: PointerEvent) {
      if (slashMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setDismissedSlashIndex(slashTrigger?.startIndex ?? null);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [slashMenuOpen, slashTrigger]);

  useEffect(() => {
    if (!slashEnabled && slashTrigger) {
      setSlashTrigger(null);
    }
  }, [slashEnabled, slashTrigger]);

  // 键盘导航时把高亮项滚进菜单可视区；只滚动菜单自身，不影响外层滚动容器
  useEffect(() => {
    if (!slashMenuOpen) {
      return;
    }

    const menu = slashMenuRef.current;
    const option = menu?.querySelectorAll<HTMLElement>('.composer-slash-option')[slashActiveIndex];
    if (!menu || !option) {
      return;
    }

    const menuRect = menu.getBoundingClientRect();
    const optionRect = option.getBoundingClientRect();
    if (optionRect.top < menuRect.top) {
      menu.scrollTop -= menuRect.top - optionRect.top;
    } else if (optionRect.bottom > menuRect.bottom) {
      menu.scrollTop += optionRect.bottom - menuRect.bottom;
    }
  }, [slashActiveIndex, slashMenuOpen]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    editor.style.height = 'auto';
    editor.style.height = `${Math.min(editor.scrollHeight, 180)}px`;
  }, [editorRef, value]);

  async function handleSelectFiles() {
    try {
      const selectedAttachments = await desktopAppClient.selectFiles();
      if (selectedAttachments.length === 0) {
        return;
      }
      onAttachmentsChange([...attachments, ...selectedAttachments.map((attachment) => ({ ...attachment }))]);
    } catch (error) {
      console.error(error);
      await desktopAppClient.alertDialog({
        message: '添加附件失败。',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function handleDragEnter(event: DragEvent<HTMLFormElement>) {
    if (isRunning || !hasFilesPayload(event)) {
      return;
    }
    event.preventDefault();
    dragCounterRef.current += 1;
    setIsDragActive(true);
  }

  function handleDragOver(event: DragEvent<HTMLFormElement>) {
    if (isRunning || !hasFilesPayload(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  function handleDragLeave(event: DragEvent<HTMLFormElement>) {
    if (isRunning || !hasFilesPayload(event)) {
      return;
    }
    event.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setIsDragActive(false);
    }
  }

  /** 把路径引用追加到输入区末尾，并把光标移到末尾。 */
  function insertPathReferences(paths: string[]) {
    const nextValue = appendPathReferences(value, paths);
    if (nextValue === value) {
      return;
    }
    onChange(nextValue);
    requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }
      editor.focus();
      editor.setSelectionRange(nextValue.length, nextValue.length);
    });
  }

  async function handleDrop(event: DragEvent<HTMLFormElement>) {
    if (isRunning || !hasFilesPayload(event)) {
      return;
    }
    event.preventDefault();
    dragCounterRef.current = 0;
    setIsDragActive(false);

    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length === 0) {
      return;
    }

    try {
      const pathToFile = new Map<string, File>();
      const paths: string[] = [];
      for (const file of files) {
        const filePath = desktopAppClient.getPathForFile(file);
        if (!filePath) {
          continue;
        }
        pathToFile.set(filePath, file);
        paths.push(filePath);
      }
      if (paths.length === 0) {
        return;
      }

      const result = await desktopAppClient.attachFromPaths(paths);

      // 不支持的类型（视频、exe 等）以路径引用插入输入区，不占附件名额；
      // 主进程已把它们加入运行时白名单，模型可用系统工具直接处理这些文件。
      if (result.unsupportedPaths.length > 0) {
        insertPathReferences(result.unsupportedPaths);
      }

      const remaining = MAX_ATTACHMENTS - attachments.length;
      const incoming = result.attachments.slice(0, Math.max(0, remaining));
      const enriched = await Promise.all(
        incoming.map(async (attachment) => {
          if (attachment.meta.kind !== 'image') {
            return { ...attachment };
          }
          const file = pathToFile.get(attachment.localPath);
          if (!file) {
            return { ...attachment };
          }
          const thumbnailDataUrl = await readFileAsDataUrl(file);
          return { ...attachment, thumbnailDataUrl };
        }),
      );
      if (enriched.length > 0) {
        onAttachmentsChange([...attachments, ...enriched]);
      }

      if (result.errors.length > 0) {
        await desktopAppClient.alertDialog({
          message: '以下文件无法添加：',
          detail: result.errors.join('\n'),
        });
      }
    } catch (error) {
      console.error(error);
      await desktopAppClient.alertDialog({
        message: '添加附件失败。',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(event.clipboardData.items);
    const imageItem = items.find((item) => item.type.startsWith('image/'));
    if (!imageItem) {
      return;
    }

    event.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) {
      return;
    }
    if (attachments.length >= MAX_ATTACHMENTS) {
      return;
    }
    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      return;
    }

    const arrayBuffer = await file.arrayBuffer();
    const imported = await desktopAppClient.importPastedImage(arrayBuffer, file.name || 'pasted-image.png', file.type || 'image/png');
    const meta = buildPastedImageMeta(file, imported.size);
    if (!meta) {
      return;
    }

    const thumbnailDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

    onAttachmentsChange([...attachments, { meta, localPath: imported.localPath, thumbnailDataUrl }]);
  }

  function syncSlashTrigger(text: string, caret: number | null) {
    if (!slashEnabled || caret === null) {
      setSlashTrigger(null);
      setDismissedSlashIndex(null);
      return;
    }

    const nextTrigger = getSlashTriggerState(text, caret);
    setSlashTrigger(nextTrigger);

    // 离开触发态就把收起标记清掉，这样删掉再重新打 "/" 能正常弹出
    if (!nextTrigger) {
      setDismissedSlashIndex(null);
    }
  }

  function dismissSlashMenu() {
    setDismissedSlashIndex(slashTrigger?.startIndex ?? null);
  }

  function handleSlashSelect(name: string) {
    const trigger = slashTrigger;
    if (!trigger) {
      return;
    }

    setRecentSlashNames(recordRecentSlashName(name));
    const next = applySlashSelection(value, trigger, name);
    setSlashTrigger(null);
    setDismissedSlashIndex(null);
    onChange(next.text);

    // onChange 走的是受控 value，光标要等新值渲染完再设置
    requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }
      editor.focus();
      editor.setSelectionRange(next.caret, next.caret);
    });
  }

  function handleEditorChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = event.currentTarget.value;
    // 用户手动改动即退出历史浏览：后续 ↑ 重新定格快照、↓ 不再还原旧草稿
    historyIndexRef.current = null;
    onChange(nextValue);
    syncSlashTrigger(nextValue, event.currentTarget.selectionStart);
  }

  function handleEditorSelect(event: SyntheticEvent<HTMLTextAreaElement>) {
    // 纯移动光标（点击、方向键）也可能进出触发态
    syncSlashTrigger(event.currentTarget.value, event.currentTarget.selectionStart);
  }

  /** 光标是否在首行（其前无换行）——↑ 才用来调起更早的输入记录，否则按默认在多行内上移。 */
  function caretAtFirstLine(el: HTMLTextAreaElement): boolean {
    return el.selectionStart === el.selectionEnd && el.value.lastIndexOf('\n', el.selectionStart - 1) === -1;
  }

  /** 光标是否在末行（其后无换行）——↓ 才用来往更新的输入记录走。 */
  function caretAtLastLine(el: HTMLTextAreaElement): boolean {
    return el.selectionStart === el.selectionEnd && el.value.indexOf('\n', el.selectionEnd) === -1;
  }

  /** 把历史值写入受控输入框，下一帧把光标移到末尾。 */
  function applyHistoryValue(text: string) {
    onChange(text);
    requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }
      editor.focus();
      editor.setSelectionRange(text.length, text.length);
    });
  }

  /** ↑：调起更早的输入记录。返回 true 表示已消费（外层应 preventDefault）。 */
  function recallOlderInput(): boolean {
    if (!conversationId) {
      return false;
    }
    if (historyIndexRef.current === null) {
      const snapshot = readInputHistory(conversationId);
      if (snapshot.length === 0) {
        return false; // 无记录：不拦截，交回默认
      }
      historySnapshotRef.current = snapshot;
      historyDraftRef.current = value; // 暂存当前草稿
      historyIndexRef.current = snapshot.length - 1;
      applyHistoryValue(snapshot[historyIndexRef.current]);
      return true;
    }
    if (historyIndexRef.current > 0) {
      historyIndexRef.current -= 1;
      applyHistoryValue(historySnapshotRef.current[historyIndexRef.current]);
    }
    return true; // 已到最早也消费，避免光标跳动
  }

  /** ↓：往更新的输入记录走；越过最新则还原草稿并退出浏览。返回 true 表示已消费。 */
  function recallNewerInput(): boolean {
    if (historyIndexRef.current === null) {
      return false; // 未在浏览历史：不拦截，交回默认
    }
    const snapshot = historySnapshotRef.current;
    if (historyIndexRef.current < snapshot.length - 1) {
      historyIndexRef.current += 1;
      applyHistoryValue(snapshot[historyIndexRef.current]);
    } else {
      historyIndexRef.current = null;
      applyHistoryValue(historyDraftRef.current);
    }
    return true;
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // 菜单打开时优先消费导航键；输入法组字期间一律不拦截
    if (slashMenuOpen && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashActiveIndex((current) => (current + 1) % slashVisibleItems.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashActiveIndex((current) => (current - 1 + slashVisibleItems.length) % slashVisibleItems.length);
        return;
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const target = slashVisibleItems[slashActiveIndex] ?? slashVisibleItems[0];
        if (target) {
          handleSlashSelect(target.name);
        }
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        dismissSlashMenu();
        return;
      }
    }

    // slash 菜单未打开时，↑/↓ 在光标处于首/末行时调起该会话的输入记录（保多行编辑与 IME）
    if (!slashMenuOpen && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      if (event.key === 'ArrowUp' && caretAtFirstLine(event.currentTarget) && recallOlderInput()) {
        event.preventDefault();
        return;
      }
      if (event.key === 'ArrowDown' && caretAtLastLine(event.currentTarget) && recallNewerInput()) {
        event.preventDefault();
        return;
      }
    }

    onKeyDown(event);

    if (
      !event.defaultPrevented
      && (event.key === 'Backspace' || event.key === 'Delete')
      && event.currentTarget.value.trim() === ''
      && attachments.length > 0
    ) {
      event.preventDefault();
      onAttachmentsChange(attachments.slice(0, -1));
    }
  }

  function handleModelTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (modelSelectDisabled) {
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setModelMenuOpen((current) => !current);
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setModelMenuOpen(true);
    }
  }

  function handleModelSelect(model: string) {
    if (modelSelectDisabled) {
      return;
    }

    onModelChange(model);
    setModelMenuOpen(false);
  }

  function toggleEffortMenu(model: string, anchor: HTMLButtonElement) {
    if (effortMenuModel === model) {
      setEffortMenuModel(null);
      setEffortMenuPos(null);
      return;
    }

    const dropdown = modelDropdownRef.current;
    if (dropdown) {
      const anchorRect = anchor.getBoundingClientRect();
      const dropdownRect = dropdown.getBoundingClientRect();
      setEffortMenuPos({
        // 从编辑按钮上方弹出：工具栏贴近窗口底部，向下弹会超出屏幕
        bottom: dropdownRect.bottom - anchorRect.top + 4,
        right: Math.max(0, dropdownRect.right - anchorRect.right),
      });
    }
    setEffortMenuModel(model);
  }

  function removeAttachment(attachmentId: string) {
    onAttachmentsChange(attachments.filter((attachment) => attachment.meta.id !== attachmentId));
  }

  function handleSubmitWithAttachments(event: FormEvent<HTMLFormElement>) {
    if (!value.trim() && attachments.length === 0) {
      event.preventDefault();
      return;
    }
    onSubmit(event);
  }

  return (
    <form
      className={`composer${isDragActive ? ' composer-drag-active' : ''}`}
      onSubmit={handleSubmitWithAttachments}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="composer-shell">
        {isDragActive ? (
          <div className="composer-drop-overlay" aria-hidden="true">
            <span className="composer-drop-overlay-text">松开以添加附件</span>
          </div>
        ) : null}
        <div className="composer-editor-shell">
          <div className="composer-rich-surface">
            {attachments.length > 0 ? (
              <div className="composer-attachments-inline" aria-label="附件列表">
                {attachments.map((attachment) => (
                  <span key={attachment.meta.id} className="composer-attachment-inline">
                    {attachment.meta.kind === 'image' && attachment.thumbnailDataUrl ? (
                      <span className="composer-attachment-thumbnail">
                        <img src={attachment.thumbnailDataUrl} alt={attachment.meta.originalName} />
                        <button
                          type="button"
                          className="composer-attachment-remove"
                          onClick={() => removeAttachment(attachment.meta.id)}
                          aria-label={`删除附件 ${attachment.meta.originalName}`}
                        >
                          <X size={12} strokeWidth={2} />
                        </button>
                      </span>
                    ) : (
                      <span className="composer-attachment-chip">
                        <AttachmentIcon kind={attachment.meta.kind} />
                        <span className="composer-attachment-name">{attachment.meta.originalName}</span>
                        <span className="composer-attachment-size">{formatAttachmentSize(attachment.meta.size)}</span>
                        <button
                          type="button"
                          className="composer-attachment-remove"
                          onClick={() => removeAttachment(attachment.meta.id)}
                          aria-label={`删除附件 ${attachment.meta.originalName}`}
                        >
                          <X size={12} strokeWidth={2} />
                        </button>
                      </span>
                    )}
                  </span>
                ))}
              </div>
            ) : null}
            <textarea
              ref={editorRef}
              className="composer-input"
              value={value}
              rows={3}
              disabled={isRunning}
              placeholder={placeholder}
              onChange={handleEditorChange}
              onPaste={handlePaste}
              onKeyDown={handleEditorKeyDown}
              onSelect={handleEditorSelect}
              onBlur={(event) => {
                // 点击候选项时焦点会移到菜单里的按钮，这种情况不能关菜单
                if (slashMenuRef.current?.contains(event.relatedTarget as Node)) {
                  return;
                }
                dismissSlashMenu();
              }}
              role={slashMenuOpen ? 'combobox' : undefined}
              aria-expanded={slashMenuOpen || undefined}
              aria-controls={slashMenuOpen ? slashListboxId : undefined}
              aria-autocomplete={slashMenuOpen ? 'list' : undefined}
            />
          </div>
          {slashMenuOpen ? (
            <div className="composer-slash-menu" ref={slashMenuRef} id={slashListboxId} role="listbox" aria-label="指令与 Skills">
              {slashRenderModel.groups.map((group) => (
                <div key={group.key} className="composer-slash-group">
                  <div className="composer-slash-group-title">{group.title}</div>
                  {group.items.map(({ item, index }) => (
                    <button
                      key={`${group.key}:${item.name}`}
                      type="button"
                      role="option"
                      aria-selected={index === slashActiveIndex}
                      className={`composer-slash-option${index === slashActiveIndex ? ' composer-slash-option-active' : ''}`}
                      onPointerEnter={() => setSlashActiveIndex(index)}
                      onClick={() => handleSlashSelect(item.name)}
                    >
                      <span className="composer-slash-option-icon" aria-hidden="true">
                        {item.kind === 'command' ? <SquareTerminal size={15} strokeWidth={2} /> : <Sparkles size={15} strokeWidth={2} />}
                      </span>
                      <span className="composer-slash-option-text">
                        <span className="composer-slash-option-name">/{item.name}</span>
                        <span className="composer-slash-option-description">{item.description}</span>
                      </span>
                    </button>
                  ))}
                  {group.hiddenCount > 0 ? (
                    <button
                      type="button"
                      className="composer-slash-more"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setExpandedSlashGroups((prev) => new Set(prev).add(group.key))}
                    >
                      Show {group.hiddenCount} more
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          <div className="composer-toolbar">
            {hideAttachmentButton ? null : (
              <button
                type="button"
                className="composer-toolbar-icon-button"
                onClick={() => {
                  void handleSelectFiles();
                }}
                disabled={isRunning || attachments.length >= MAX_ATTACHMENTS}
                title="添加附件"
                aria-label="添加附件"
              >
                <Plus size={17} strokeWidth={2.2} />
              </button>
            )}
            <div className="composer-model-dropdown" ref={modelDropdownRef}>
              <button
                type="button"
                className="composer-model-trigger"
                onClick={() => {
                  if (!modelSelectDisabled) {
                    setModelMenuOpen((current) => !current);
                  }
                }}
                onKeyDown={handleModelTriggerKeyDown}
                disabled={modelSelectDisabled}
                title={modelSelectTitle}
                aria-label="选择模型"
                aria-haspopup="listbox"
                aria-expanded={modelMenuOpen}
                aria-controls={modelListboxId}
              >
                <span className="composer-model-trigger-main">
                  <span className="composer-model-trigger-label">{modelTriggerLabel}</span>
                  {selectedModelOption ? (
                    <span className="composer-model-effort-badge">{REASONING_EFFORT_LABELS[reasoningEffortByModel[selectedModelOption] ?? 'low']}</span>
                  ) : null}
                </span>
                <ChevronDown className={modelMenuOpen ? 'composer-model-trigger-icon composer-model-trigger-icon-open' : 'composer-model-trigger-icon'} size={16} strokeWidth={2} aria-hidden="true" />
              </button>
              {modelMenuOpen ? (
                <div
                  className="composer-model-menu"
                  id={modelListboxId}
                  role="listbox"
                  aria-label="模型列表"
                  onScroll={() => {
                    setEffortMenuModel(null);
                    setEffortMenuPos(null);
                  }}
                >
                  {hasModels ? availableModels.map((model) => {
                    const selected = model === selectedModelOption;
                    const effort = reasoningEffortByModel[model] ?? 'low';
                    const effortMenuOpen = effortMenuModel === model;
                    return (
                      <div key={model} className="composer-model-option-row">
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className={selected ? 'composer-model-option composer-model-option-selected' : 'composer-model-option'}
                          onClick={() => handleModelSelect(model)}
                          title={model}
                        >
                          <span className="composer-model-option-name">{model}</span>
                          <span className="composer-model-effort-badge">{REASONING_EFFORT_LABELS[effort]}</span>
                        </button>
                        <button
                          type="button"
                          className="composer-model-effort-edit"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleEffortMenu(model, event.currentTarget);
                          }}
                          title="设置思考强度"
                          aria-label={`设置 ${model} 的思考强度`}
                          aria-expanded={effortMenuOpen}
                        >
                          <Pencil size={13} strokeWidth={2} />
                        </button>
                      </div>
                    );
                  }) : (
                    <div className="composer-model-menu-empty">{modelsError ?? '未获取到模型，请检查设置中的 API Key 与 Base URL'}</div>
                  )}
                  {/* 刷新收在菜单里；没有模型时也要能打开菜单来刷新，否则这里就成了死路 */}
                  <button
                    type="button"
                    className="composer-model-menu-refresh"
                    onClick={onRefreshModels}
                    disabled={modelsLoading}
                  >
                    <RefreshCw size={13} strokeWidth={2} className={modelsLoading ? 'composer-model-refresh-spin' : ''} />
                    <span>{modelsLoading ? '刷新中…' : '刷新模型列表'}</span>
                  </button>
                </div>
              ) : null}
              {modelMenuOpen && effortMenuModel && effortMenuPos ? (
                <div
                  className="composer-model-effort-menu"
                  role="listbox"
                  aria-label="思考强度"
                  style={{ bottom: effortMenuPos.bottom, right: effortMenuPos.right }}
                >
                  {getModelEffortOptions(effortMenuModel).map((option) => {
                    const selectedEffort = reasoningEffortByModel[effortMenuModel] ?? 'low';
                    return (
                      <button
                        key={option}
                        type="button"
                        role="option"
                        aria-selected={option === selectedEffort}
                        className={
                          option === selectedEffort
                            ? 'composer-model-effort-item composer-model-effort-item-active'
                            : 'composer-model-effort-item'
                        }
                        onClick={() => {
                          onModelReasoningEffortChange(effortMenuModel, option);
                          setEffortMenuModel(null);
                          setEffortMenuPos(null);
                        }}
                      >
                        {REASONING_EFFORT_LABELS[option]}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <button
              className={`composer-toolbar-icon-button${thinkingModeEnabled ? ' composer-toolbar-icon-button-active' : ''}`}
              type="button"
              onClick={() => onThinkingModeChange(!thinkingModeEnabled)}
              disabled={isRunning}
              title={thinkingModeEnabled ? '思考模式已开启' : '思考模式已关闭'}
              aria-label="思考模式"
              aria-pressed={thinkingModeEnabled}
            >
              <Brain size={15} strokeWidth={2} />
            </button>
            <button
              className={`composer-send-button${isRunning ? ' composer-send-button-stop' : ''}`}
              type={isRunning ? 'button' : 'submit'}
              onClick={isRunning ? onCancel : undefined}
              disabled={!isRunning && !canSubmit}
              title={isRunning ? '停止生成' : '发送'}
              aria-label={isRunning ? '停止生成' : '发送'}
            >
              {isRunning ? <Square size={12} strokeWidth={3} /> : <ArrowUp size={18} strokeWidth={2.6} />}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
