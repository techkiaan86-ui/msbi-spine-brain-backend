import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_VERSION = 'v1';

/**
 * Ensures the encryption key is exactly 32 bytes for aes-256-gcm.
 */
export function getEncryptionKey(): Buffer {
  const key = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY environment variable is missing.');
  }
  
  // If the key is provided as a hex string, parse it, otherwise treat as utf-8
  const keyBuffer = key.length === 64 ? Buffer.from(key, 'hex') : Buffer.from(key, 'utf8');
  
  if (keyBuffer.length !== 32) {
    throw new Error(`INTEGRATION_ENCRYPTION_KEY must be exactly 32 bytes (256 bits). Current length: ${keyBuffer.length}`);
  }
  
  return keyBuffer;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Format: {version}:{iv}:{authTag}:{encryptedData} (all hex encoded except version)
 * @param text The plaintext string to encrypt.
 * @returns The formatted encrypted string, or null if input is falsy.
 */
export function encryptCredential(text: any): string | null {
  if (!text || typeof text !== 'string') return null;

  // If it already looks encrypted, skip encryption to allow safe migration
  if (text.startsWith(`${ENCRYPTION_VERSION}:`)) {
    return text;
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  const ivHex = iv.toString('hex');
  
  return `${ENCRYPTION_VERSION}:${ivHex}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an encrypted credential string.
 * @param encryptedText The formatted encrypted string.
 * @returns The plaintext string, or the original string if it wasn't encrypted (for migration), or null.
 */
export function decryptCredential(encryptedText: any): string | null {
  if (!encryptedText || typeof encryptedText !== 'string') return null;

  // Check if it's in our known format, if not, assume it's plaintext (for legacy safe migration)
  if (!encryptedText.startsWith(`${ENCRYPTION_VERSION}:`)) {
    return encryptedText;
  }

  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 4) {
      throw new Error('Invalid encrypted credential format.');
    }
    
    const [, ivHex, authTagHex, encryptedDataHex] = parts;
    
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedDataHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Failed to decrypt credential:', error);
    return null; // Don't crash, just fail to return the credential
  }
}
