import {
  base64UrlEncode,
  generateBase64UrlRandomString,
  hashSecret,
} from "@src/auth/hash";

export const oauthCookieOptions = {
  path: "/",
  secure: import.meta.env.PROD,
  httpOnly: true,
  maxAge: 60 * 10,
  sameSite: "lax",
} as const;

export function generateState(): string {
  return generateBase64UrlRandomString(32);
}

export function generateCodeVerifier(): string {
  return generateBase64UrlRandomString(32);
}

export function createS256CodeChallenge(verifier: string): string {
  return base64UrlEncode(hashSecret(verifier));
}
