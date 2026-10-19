import { safeStorage } from 'electron';

/**
 * 邮箱密码的加密存储封装。基于 Electron safeStorage：
 * Windows 走 DPAPI、macOS 走 Keychain、Linux 走 libsecret 等系统密钥库。
 * 密钥库不可用时一律抛错，不做明文降级。
 */

export function isSecretStorageAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function encryptSecret(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统密钥库不可用，无法安全保存邮箱密码。');
  }
  return safeStorage.encryptString(plain).toString('base64');
}

export function decryptSecret(encoded: string): string {
  if (!encoded) {
    return '';
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统密钥库不可用，无法解密邮箱密码。');
  }
  return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
}
