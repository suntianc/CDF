import { safeStorage } from 'electron';

export function encryptApiKey(apiKey: string): string {
  if (!apiKey) return '';
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS safeStorage is not available on this platform.');
  }
  const encryptedBuffer = safeStorage.encryptString(apiKey);
  return encryptedBuffer.toString('base64');
}

export function decryptApiKey(encryptedBase64: string): string {
  if (!encryptedBase64) return '';
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS safeStorage is not available on this platform.');
  }
  const buffer = Buffer.from(encryptedBase64, 'base64');
  return safeStorage.decryptString(buffer);
}
