import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } from "astro:env/server";
import {
  base64UrlDecode,
  base64UrlEncode,
  generateBase64UrlRandomString,
  hashSecret,
} from "./hash";

const authorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const tokenEndpoint = "https://oauth2.googleapis.com/token";

export interface GoogleTokenResponse {
  id_token: string;
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export function generateState(): string {
  return generateBase64UrlRandomString(32);
}

export function generateCodeVerifier(): string {
  return generateBase64UrlRandomString(32);
}

function createS256CodeChallenge(verifier: string): string {
  return base64UrlEncode(hashSecret(verifier));
}

export function decodeIdToken(idToken: string): unknown {
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid JWT");
    }
    const payload = JSON.parse(base64UrlDecode(parts[1]).toString("utf-8"));
    if (typeof payload !== "object" || payload === null) {
      throw new Error("Invalid JWT payload");
    }
    return payload;
  } catch (e) {
    throw new Error("Invalid ID token", { cause: e });
  }
}

class GoogleOAuthClient {
  constructor(
    private clientId: string,
    private clientSecret: string,
    private redirectURI: string,
  ) {}

  createAuthorizationURL(state: string, codeVerifier: string, scopes: string[]): URL {
    const url = new URL(authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", this.redirectURI);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("code_challenge", createS256CodeChallenge(codeVerifier));
    if (scopes.length > 0) {
      url.searchParams.set("scope", scopes.join(" "));
    }
    return url;
  }

  async validateAuthorizationCode(code: string, codeVerifier: string): Promise<GoogleTokenResponse> {
    const body = new URLSearchParams();
    body.set("grant_type", "authorization_code");
    body.set("code", code);
    body.set("redirect_uri", this.redirectURI);
    body.set("code_verifier", codeVerifier);

    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: `Basic ${credentials}`,
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`Token endpoint returned status ${response.status}`);
    }

    return (await response.json()) as GoogleTokenResponse;
  }
}

export const google = new GoogleOAuthClient(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
);