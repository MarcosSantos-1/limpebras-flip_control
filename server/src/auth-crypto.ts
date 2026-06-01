import crypto from "node:crypto";
import { config } from "./config.js";

function deriveKey(): Buffer {
  return crypto.scryptSync(config.authSecret, "flip-control-auth", 32);
}

const encryptionKey = deriveKey();

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

export function encryptPassword(password: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [base64UrlEncode(iv), base64UrlEncode(authTag), base64UrlEncode(encrypted)].join(".");
}

export function decryptPassword(payload: string): string {
  const [ivPart, tagPart, encryptedPart] = payload.split(".");
  if (!ivPart || !tagPart || !encryptedPart) {
    throw new Error("Invalid encrypted password payload");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, base64UrlDecode(ivPart));
  decipher.setAuthTag(base64UrlDecode(tagPart));
  const decrypted = Buffer.concat([decipher.update(base64UrlDecode(encryptedPart)), decipher.final()]);
  return decrypted.toString("utf8");
}

export function passwordsMatch(storedEncryptedPassword: string, providedPassword: string): boolean {
  try {
    return crypto.timingSafeEqual(
      Buffer.from(decryptPassword(storedEncryptedPassword), "utf8"),
      Buffer.from(providedPassword, "utf8")
    );
  } catch {
    return false;
  }
}
