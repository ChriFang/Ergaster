import type { AppConfig, MaskedAppConfig } from '../../../shared/config';

export function splitMultilineInput(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeConfigForm(config: MaskedAppConfig): AppConfig {
  return {
    deepseekApiKey: '',
    githubToken: '',
    model: config.model,
    apiBaseUrl: config.apiBaseUrl,
    maxToolRounds: config.maxToolRounds,
    thinkingModeEnabled: config.thinkingModeEnabled,
    memoryEnabled: config.memoryEnabled,
    enabledExtensions: config.enabledExtensions,
    reasoningEffortByModel: config.reasoningEffortByModel,
    oneApiCompatibilityEnabled: config.oneApiCompatibilityEnabled,
    contextWindowSize: config.contextWindowSize,
    modelIdleTimeoutSeconds: config.modelIdleTimeoutSeconds,
    closeAction: config.closeAction,
    toolSettings: {
      allowedPaths: config.toolSettings?.allowedPaths ?? [],
      searchRoots: config.toolSettings?.searchRoots ?? [],
      draftDirectory: config.toolSettings?.draftDirectory ?? '',
      commandAllowlist: config.toolSettings?.commandAllowlist ?? [],
      commandDenylist: config.toolSettings?.commandDenylist ?? [],
      autoExecuteTools: config.toolSettings?.autoExecuteTools ?? [],
      downloadAllowedHosts: config.toolSettings?.downloadAllowedHosts ?? [],
    },
  };
}
