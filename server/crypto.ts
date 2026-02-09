import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const keyBase64 = process.env.BROKER_TOKEN_KEY;
  if (!keyBase64) {
    throw new Error("BROKER_TOKEN_KEY environment variable is required for encryption");
  }
  
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("BROKER_TOKEN_KEY must be a 32-byte (256-bit) key encoded in base64");
  }
  
  return key;
}

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function encryptToken(plaintext: string): EncryptedData {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  
  const authTag = cipher.getAuthTag();
  
  return {
    ciphertext: encrypted,
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decryptToken(encryptedData: EncryptedData): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(encryptedData.iv, "base64");
  const authTag = Buffer.from(encryptedData.authTag, "base64");
  
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedData.ciphertext, "base64", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
}

export interface BrokerCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string;
  sandboxAccessToken?: string;
}

export function encryptCredentials(credentials: BrokerCredentials): EncryptedData {
  return encryptToken(JSON.stringify(credentials));
}

export function decryptCredentials(encryptedData: EncryptedData): BrokerCredentials {
  const json = decryptToken(encryptedData);
  return JSON.parse(json);
}

export function hasEncryptionKey(): boolean {
  return !!process.env.BROKER_TOKEN_KEY;
}

export function generateEncryptionKey(): string {
  return randomBytes(32).toString("base64");
}
