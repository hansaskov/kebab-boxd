import { createHash, timingSafeEqual } from "node:crypto";

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function base64UrlDecode(s: string): Buffer<ArrayBuffer> {
  return Buffer.from(s, "base64url");
}

export function generateSecureRandomString(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";

  const bytes = randomBytes(24);

  let id = "";
  for (const byte of bytes) {
    id += alphabet.charAt(byte >> 3);
  }
  return id;
}

export function generateBase64UrlRandomString(byteLength = 32): string {
  return base64UrlEncode(randomBytes(byteLength));
}

export function hashSecret(secret: string): Buffer<ArrayBuffer> {
  return createHash("sha256").update(secret, "utf8").digest();
}

// Takes as long whatever the bytes are, so the time does not tell an attacker how much of a secret they guessed.
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}
