import os from 'node:os';
import path from 'node:path';

// 应用在用户家目录下的数据根目录。各 service 的子目录（agents/conversations/skills/workflows 等）均基于此。
const appDataRoot = path.join(os.homedir(), '.ergaster');

export function getAppDataRoot() {
  return appDataRoot;
}

/** 邮件账户配置文件路径。密码字段经 safeStorage 加密后存于此。 */
export function getMailAccountsPath() {
  return path.join(appDataRoot, 'mail-accounts.json');
}

/** 长期记忆根目录。Phase 1 为全局作用域，记忆存单文件 memory/memory.json。 */
export function getMemoryRoot() {
  return path.join(appDataRoot, 'memory');
}
