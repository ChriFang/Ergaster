import type { AppConfig } from '../shared/config';

export type ConfigFormValues = AppConfig;

export const initialConfigForm: ConfigFormValues = {
  deepseekApiKey: '',
  githubToken: '',
  model: 'deepseek-v4-pro',
  apiBaseUrl: 'https://api.deepseek.com',
  maxToolRounds: 256,
  thinkingModeEnabled: false,
  memoryEnabled: true,
  enabledExtensions: [],
  reasoningEffortByModel: {},
  oneApiCompatibilityEnabled: false,
  contextWindowSize: 128000,
  modelIdleTimeoutSeconds: 180,
  closeAction: 'ask',
  toolSettings: {
    allowedPaths: [],
    searchRoots: [],
    draftDirectory: '',
    commandAllowlist: [],
    commandDenylist: [],
    autoExecuteTools: [],
    downloadAllowedHosts: [],
  },
};
