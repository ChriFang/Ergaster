import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { AppConfig, MaskedAppConfig, ReasoningEffort, ToolSettings, WindowCloseAction } from '../../../shared/config';
import { initialConfigForm } from '../../config-form';
import { normalizeConfigForm, splitMultilineInput } from '../../features/settings/settings-model';
import { desktopAppClient } from '../desktop/desktop-app-client';
import type { SettingsDialogState, SettingsDialogTab } from '../types/app-shell';

function formatMultilineInput(values: string[] | undefined) {
  return (values ?? []).join('\n');
}


export function useSettingsState() {
  const [settingsDialogState, setSettingsDialogState] = useState<SettingsDialogState>({
    open: false,
    tab: 'general',
  });
  const [config, setConfig] = useState<MaskedAppConfig | null>(null);
  const [formValues, setFormValuesState] = useState<AppConfig>(initialConfigForm);
  const [allowedPathsText, setAllowedPathsText] = useState(() => formatMultilineInput(initialConfigForm.toolSettings?.allowedPaths));
  const [searchRootsText, setSearchRootsText] = useState(() => formatMultilineInput(initialConfigForm.toolSettings?.searchRoots));
  const [commandAllowlistText, setCommandAllowlistText] = useState(() => formatMultilineInput(initialConfigForm.toolSettings?.commandAllowlist));
  const [commandDenylistText, setCommandDenylistText] = useState(() => formatMultilineInput(initialConfigForm.toolSettings?.commandDenylist));
  const [downloadAllowedHostsText, setDownloadAllowedHostsText] = useState(() => formatMultilineInput(initialConfigForm.toolSettings?.downloadAllowedHosts));
  const [saveStatus, setSaveStatus] = useState('');

  const [showApiKey, setShowApiKey] = useState(false);
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const formValuesRef = useRef(formValues);
  const savedStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setFormValues = useCallback((action: SetStateAction<AppConfig>) => {
    setFormValuesState((current) => {
      const next = typeof action === 'function' ? action(current) : action;
      if (next.toolSettings?.allowedPaths !== current.toolSettings?.allowedPaths) {
        setAllowedPathsText(formatMultilineInput(next.toolSettings?.allowedPaths));
      }
      if (next.toolSettings?.searchRoots !== current.toolSettings?.searchRoots) {
        setSearchRootsText(formatMultilineInput(next.toolSettings?.searchRoots));
      }
      if (next.toolSettings?.commandAllowlist !== current.toolSettings?.commandAllowlist) {
        setCommandAllowlistText(formatMultilineInput(next.toolSettings?.commandAllowlist));
      }
      if (next.toolSettings?.commandDenylist !== current.toolSettings?.commandDenylist) {
        setCommandDenylistText(formatMultilineInput(next.toolSettings?.commandDenylist));
      }
      if (next.toolSettings?.downloadAllowedHosts !== current.toolSettings?.downloadAllowedHosts) {
        setDownloadAllowedHostsText(formatMultilineInput(next.toolSettings?.downloadAllowedHosts));
      }
      return next;
    });
  }, []);

  useEffect(() => {
    formValuesRef.current = formValues;
  }, [formValues]);


  function openSettingsDialog(tab: SettingsDialogTab, create = false, agentId?: string) {
    setSettingsDialogState({ open: true, tab, create, agentId });
    if (tab === 'general' || tab === 'tools') {
      // 托盘关闭弹窗等主进程侧可能已更新配置，打开时重拉一次避免表单显示陈旧值
      void desktopAppClient.getConfig()
        .then((saved) => {
          setConfig(saved);
          setFormValues(normalizeConfigForm(saved));
        })
        .catch(() => {});
    }
  }

  function closeSettingsDialog() {
    // 兜底 flush：若关闭时某配置字段还没失焦（如键盘直接关弹窗），这里再存一次，避免丢改动。
    if (settingsDialogState.tab === 'general' || settingsDialogState.tab === 'tools') {
      void saveConfigWithValues(formValuesRef.current).catch(() => {});
    }
    setSettingsDialogState((current) => ({ ...current, open: false }));
  }

  function updateToolSettings(updater: (current: ToolSettings | undefined) => ToolSettings) {
    setFormValues((current) => ({
      ...current,
      toolSettings: updater(current.toolSettings),
    }));
  }

  function buildConfigPayload(values: AppConfig): Partial<AppConfig> {
    const payload: Partial<AppConfig> = {
      apiBaseUrl: values.apiBaseUrl,
      maxToolRounds: values.maxToolRounds,
      thinkingModeEnabled: values.thinkingModeEnabled,
      memoryEnabled: values.memoryEnabled,
      enabledExtensions: values.enabledExtensions,
      reasoningEffortByModel: values.reasoningEffortByModel,
      oneApiCompatibilityEnabled: values.oneApiCompatibilityEnabled,
      modelIdleTimeoutSeconds: values.modelIdleTimeoutSeconds,
      closeAction: values.closeAction,
      toolSettings: {
        allowedPaths: splitMultilineInput(allowedPathsText),
        searchRoots: splitMultilineInput(searchRootsText),
        draftDirectory: values.toolSettings?.draftDirectory ?? '',
        commandAllowlist: splitMultilineInput(commandAllowlistText),
        commandDenylist: splitMultilineInput(commandDenylistText),
        autoExecuteTools: values.toolSettings?.autoExecuteTools ?? [],
        downloadAllowedHosts: splitMultilineInput(downloadAllowedHostsText),
      },
    };

    if (values.deepseekApiKey.trim()) {
      payload.deepseekApiKey = values.deepseekApiKey.trim();
    }

    if (values.githubToken.trim()) {
      payload.githubToken = values.githubToken.trim();
    }

    return payload;
  }

  function flashSaved() {
    setSaveStatus('已保存');
    if (savedStatusTimerRef.current) {
      clearTimeout(savedStatusTimerRef.current);
    }
    savedStatusTimerRef.current = setTimeout(() => setSaveStatus(''), 1600);
  }

  /**
   * 持久化整份表单，供「改即存」各入口统一调用。
   * 刻意不回灌 formValues、不重置密钥显隐，避免打断正在编辑的字段（如清空密钥输入框）。
   */
  async function saveConfigWithValues(values: AppConfig) {
    const saved = await desktopAppClient.saveConfig(buildConfigPayload(values));
    setConfig(saved);
    flashSaved();
    return saved;
  }

  /** 失焦即存：持久化当前最新表单。文本 / 多行 / 密钥字段的 onBlur 调用。 */
  function autoSaveConfig() {
    void saveConfigWithValues(formValuesRef.current).catch(() => {
      setSaveStatus('保存失败，请重试');
    });
  }

  /** 改一个开关 / 选项并立即持久化。复选框、芯片等无中间输入态的字段使用。 */
  function changeConfigAndSave(updater: (current: AppConfig) => AppConfig) {
    const next = updater(formValuesRef.current);
    setFormValues(next);
    void saveConfigWithValues(next).catch(() => {
      setSaveStatus('保存失败，请重试');
    });
  }

  /** API Key / Base URL 失焦：持久化后刷新模型列表（连接信息变化会影响可用模型）。 */
  function commitModelConnection() {
    void saveConfigWithValues(formValuesRef.current)
      .then(() => {
        void refreshModels();
      })
      .catch(() => {
        setSaveStatus('保存失败，请重试');
      });
  }

  async function handleThinkingModeChange(value: boolean) {
    const previousValues = formValues;
    const nextValues = { ...previousValues, thinkingModeEnabled: value };
    setFormValues(nextValues);

    try {
      await saveConfigWithValues(nextValues);
    } catch {
      setFormValues(previousValues);
      setSaveStatus('保存失败，请重试');
    }
  }

  async function handleCloseActionChange(value: WindowCloseAction) {
    const previousValues = formValues;
    const nextValues = { ...previousValues, closeAction: value };
    setFormValues(nextValues);

    try {
      await saveConfigWithValues(nextValues);
    } catch {
      setFormValues(previousValues);
      setSaveStatus('保存失败，请重试');
    }
  }

  /** 添加扩展能力：写入 config.enabledExtensions（去重），成功后切到该扩展的设置页。 */
  async function addExtension(id: string) {
    if (formValues.enabledExtensions.includes(id)) {
      setSettingsDialogState((current) => ({ ...current, open: true, tab: `extension:${id}` }));
      return;
    }
    const previousValues = formValues;
    const nextValues = { ...previousValues, enabledExtensions: [...previousValues.enabledExtensions, id] };
    setFormValues(nextValues);
    try {
      await saveConfigWithValues(nextValues);
      setSettingsDialogState((current) => ({ ...current, open: true, tab: `extension:${id}` }));
    } catch {
      setFormValues(previousValues);
      setSaveStatus('添加扩展失败，请重试。');
    }
  }

  /** 移除扩展能力：仅从 enabledExtensions 删除（保留该扩展已保存的配置）；若正停留在该扩展页则退回目录。 */
  async function removeExtension(id: string) {
    const previousValues = formValues;
    const nextValues = { ...previousValues, enabledExtensions: previousValues.enabledExtensions.filter((item) => item !== id) };
    setFormValues(nextValues);
    setSettingsDialogState((current) => (current.tab === `extension:${id}` ? { ...current, tab: 'extensions' } : current));
    try {
      await saveConfigWithValues(nextValues);
    } catch {
      setFormValues(previousValues);
      setSaveStatus('移除扩展失败，请重试。');
    }
  }


  async function handleModelReasoningEffortChange(model: string, effort: ReasoningEffort) {
    const previousValues = formValues;
    const nextValues = {
      ...previousValues,
      reasoningEffortByModel: { ...previousValues.reasoningEffortByModel, [model]: effort },
    };
    setFormValues(nextValues);

    try {
      await saveConfigWithValues(nextValues);
    } catch {
      setFormValues(previousValues);
      setSaveStatus('保存失败，请重试');
    }
  }

  async function selectModel(model: string) {
    setFormValues((current) => ({ ...current, model }));
    setModelsError(null);
    try {
      setConfig(await desktopAppClient.saveConfig({ model }));
    } catch (error) {
      setModelsError((error as Error).message);
    }
  }

  async function refreshModels() {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const models = await desktopAppClient.listModels();
      setAvailableModels(models);
      const current = formValuesRef.current.model;
      if (models.length > 0 && (!current || !models.includes(current))) {
        await selectModel(models[0]);
      }
    } catch (error) {
      setModelsError((error as Error).message);
    } finally {
      setModelsLoading(false);
    }
  }

  const draftDirectoryText = formValues.toolSettings?.draftDirectory ?? '';


  return {
    settingsDialogState,
    setSettingsDialogState,
    openSettingsDialog,
    closeSettingsDialog,
    config,
    setConfig,
    formValues,
    setFormValues,
    saveStatus,
    setSaveStatus,
    showApiKey,
    setShowApiKey,
    showGithubToken,
    setShowGithubToken,
    updateToolSettings,
    saveConfigWithValues,
    autoSaveConfig,
    changeConfigAndSave,
    commitModelConnection,
    handleThinkingModeChange,
    handleCloseActionChange,
    handleModelReasoningEffortChange,
    addExtension,
    removeExtension,
    availableModels,
    modelsLoading,
    modelsError,
    selectModel,
    refreshModels,
    allowedPathsText,
    setAllowedPathsText,
    searchRootsText,
    setSearchRootsText,
    commandAllowlistText,
    setCommandAllowlistText,
    commandDenylistText,
    setCommandDenylistText,
    downloadAllowedHostsText,
    setDownloadAllowedHostsText,
    draftDirectoryText,
  };
}
