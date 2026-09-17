import type { MemCellAuth } from "./types.js";

export class AuthManager {
  private cachedToken: string | null = null;
  private expiresAt: number | null = null;

  constructor(
    private readonly auth: MemCellAuth,
    private readonly baseUrl: string,
    private readonly customFetch?: typeof fetch,
  ) {}

  /**
   * Resolves a valid Bearer authorization header value.
   * For M2M OAuth client_credentials, automatically exchanges credentials and caches tokens,
   * refreshing them proactively 60 seconds before expiration.
   */
  async getAuthorizationHeader(): Promise<string> {
    if ("apiKey" in this.auth) {
      return `Bearer ${this.auth.apiKey}`;
    }

    if ("accessToken" in this.auth) {
      return `Bearer ${this.auth.accessToken}`;
    }

    if ("clientId" in this.auth && "clientSecret" in this.auth) {
      // Proactively refresh when less than 60 seconds of validity remain
      if (this.cachedToken && this.expiresAt && Date.now() < this.expiresAt - 60_000) {
        return `Bearer ${this.cachedToken}`;
      }

      return await this.fetchOAuthToken();
    }

    throw new Error("Invalid MemCell authentication configuration.");
  }

  private async fetchOAuthToken(): Promise<string> {
    if (!("clientId" in this.auth)) {
      throw new Error("OAuth credentials not configured.");
    }

    const fetcher = this.customFetch ?? fetch;
    const bodyParams = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.auth.clientId,
      client_secret: this.auth.clientSecret,
    });

    if (this.auth.scope) {
      bodyParams.set("scope", this.auth.scope);
    }

    const response = await fetcher(`${this.baseUrl}/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: bodyParams.toString(),
    });

    if (!response.ok) {
      const errorJson = (await response.json().catch(() => null)) as {
        error_description?: string;
        error?: string;
      } | null;
      const msg =
        errorJson?.error_description ||
        errorJson?.error ||
        response.statusText ||
        `HTTP ${response.status}`;
      throw new Error(`Failed to acquire OAuth access token: ${msg}`);
    }

    const data = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    const accessToken = data.access_token;
    const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;

    if (!accessToken) {
      throw new Error("OAuth token response missing access_token field.");
    }

    this.cachedToken = accessToken;
    this.expiresAt = Date.now() + expiresIn * 1000;

    return `Bearer ${accessToken}`;
  }

  /**
   * Clears any cached OAuth access token (useful for manual token invalidation or testing).
   */
  clearCache(): void {
    this.cachedToken = null;
    this.expiresAt = null;
  }
}
