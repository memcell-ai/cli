import { AuthManager } from "./auth.js";
import { ScopedMemCell } from "./scoped.js";
import { OrganizationMemCell } from "./organization.js";
import {
  MemCellError,
  RateLimitError,
  type CreateOrganizationParams,
  type FeedbackParams,
  type FeedbackResponse,
  type JobEvent,
  type MemCellConfig,
  type OrganizationItem,
  type RecallParams,
  type RecallResponse,
  type RememberParams,
  type RememberResponse,
  type ReportParams,
  type ReportResponse,
  type ScopeOptions,
  type StatementItem,
  type WaitForJobOptions,
} from "./types.js";

export class MemCell {
  readonly baseUrl: string;
  readonly authManager: AuthManager;
  private readonly config: MemCellConfig;
  private readonly customFetch?: typeof fetch;

  /**
   * Organization lifecycle management APIs.
   */
  readonly organizations = {
    /**
     * Lists organizations the authenticated user belongs to.
     */
    list: async (): Promise<OrganizationItem[]> => {
      const json = await this.request<{ ok: boolean; organizations: OrganizationItem[] }>(
        "/api/v1/organizations",
        { method: "GET" },
      );
      return json.organizations || [];
    },

    /**
     * Creates a new organization with the caller as owner.
     */
    create: async (params: CreateOrganizationParams): Promise<OrganizationItem> => {
      const json = await this.request<{ ok: boolean; organization: OrganizationItem }>(
        "/api/v1/organizations",
        {
          method: "POST",
          body: JSON.stringify(params),
        },
      );
      return json.organization;
    },

    /**
     * Fetches details of an organization by its slug handle.
     */
    get: async (slug: string): Promise<OrganizationItem> => {
      const json = await this.request<{ ok: boolean; organization: OrganizationItem }>(
        `/api/v1/organizations/${encodeURIComponent(slug)}`,
        { method: "GET" },
      );
      return json.organization;
    },
  };

  constructor(config: MemCellConfig) {
    let base = config.baseUrl;
    if (!base && typeof process !== "undefined" && process.env?.MEMCELL_BASE_URL) {
      base = process.env.MEMCELL_BASE_URL;
    }
    this.baseUrl = (base || "https://api.memcell.io").replace(/\/+$/, "");
    this.config = config;
    this.customFetch = config.fetch;
    this.authManager = new AuthManager(config.auth, this.baseUrl, this.customFetch);
  }

  /**
   * Returns an organization-scoped MemCell handle bound to the specified organization slug.
   *
   * @example
   * ```ts
   * const acme = memcell.forOrganization("acme-corp");
   * const devopsMemory = acme.scope("devops");
   * ```
   */
  forOrganization(orgSlug: string): OrganizationMemCell {
    return new OrganizationMemCell(this, orgSlug);
  }

  /**
   * Creates a scoped handle bound to a specific namespace (and optional default subject).
   *
   * @example
   * ```ts
   * const canaryMemory = memcell.scope("acme-corp/devops", { subject: "pipeline:deploy-canary" });
   * const result = await canaryMemory.wrapExecution({ action: "promote_canary" }, async (ctx) => {
   *   return await runPromotion(ctx.promptContext);
   * });
   * ```
   */
  scope(namespace: string, options?: ScopeOptions): ScopedMemCell {
    return new ScopedMemCell(this, namespace, options);
  }

  /**
   * Pre-flight recall from MemCell memory.
   */
  async recall(params: RecallParams): Promise<RecallResponse> {
    const path = this.resolveEndpoint(params.namespace, "recall");

    const payload: Record<string, unknown> = {
      query: params.query,
      intent: params.query,
      subject: params.subject,
      kind: params.kind,
      min_confidence: params.minConfidence,
      limit: params.limit,
      tags: params.tags,
      format: params.format ?? "xml",
      allow_provisional: params.allowProvisional,
    };

    if (params.namespace && !params.namespace.includes("/")) {
      payload.project = params.namespace;
    }

    const json = await this.request<any>(path, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const rawStatements: any[] = json.statements || json.results || [];
    const statements: StatementItem[] = rawStatements.map((s) => ({
      id: s.id || s.statementId,
      title: s.title,
      context: s.context ?? null,
      example: s.example ?? null,
      tags: s.tags ?? [],
      subject: s.subject ?? null,
      kind: s.kind,
      status: s.status,
      confidence: s.confidence,
      score: s.score,
      relevance: s.relevance,
      decayFactor: s.decayFactor,
      isGuard: s.isGuard ?? (s.tags?.includes("guard") || s.tags?.includes("convention")),
      isInvariant: s.isInvariant ?? (s.kind === "invariant" || s.status === "pinned"),
      expiresAt: s.expiresAt ?? null,
      createdAt: s.createdAt,
    }));

    return {
      recallId: json.recallId || json.momentId || "",
      promptContext: json.promptContext || "",
      statements,
      matchedTags: json.matchedTags,
      guardMode: json.guardMode,
      profile: json.profile,
    };
  }

  /**
   * Explicitly write a durable statement into MemCell memory.
   */
  async remember(params: RememberParams): Promise<RememberResponse> {
    const path = this.resolveEndpoint(params.namespace, "remember");

    const payload: Record<string, unknown> = {
      title: params.title,
      context: params.context,
      example: params.example,
      tags: params.tags,
      subject: params.subject,
      kind: params.kind,
      status: params.status,
      confidence: params.confidence,
      expires_at:
        params.expiresAt instanceof Date ? params.expiresAt.toISOString() : params.expiresAt,
      raw: params.raw,
      sessionId: params.sessionId,
      async: params.async,
    };

    if (params.namespace && !params.namespace.includes("/")) {
      payload.project = params.namespace;
    }

    const json = await this.request<any>(path, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (json.accepted) {
      return {
        accepted: true,
        jobId: json.jobId,
        status: json.status,
        created: [],
        note: json.note || "Job accepted for background execution.",
      };
    }

    const rawCreated: any[] = json.created || [];
    const created: StatementItem[] = rawCreated.map((s) => ({
      id: s.id,
      title: s.title,
      context: s.context ?? null,
      example: s.example ?? null,
      tags: s.tags ?? [],
      subject: s.subject ?? null,
      kind: s.kind,
      status: s.status,
      confidence: s.confidence,
      expiresAt: s.expiresAt ?? null,
    }));

    return {
      created,
      reinforced: json.reinforced,
      superseded: json.superseded,
      note: json.note,
    };
  }

  /**
   * Post-flight execution reporting closing the reinforcement loop.
   */
  async report(params: ReportParams): Promise<ReportResponse> {
    const path = this.resolveEndpoint(params.namespace, "report");

    const payload: Record<string, unknown> = {
      action_taken: params.actionTaken,
      outcome: params.outcome,
      subject: params.subject,
      reason: params.reason,
      external_ref: params.externalRef,
      payload: params.payload,
      recall_id: params.recallId,
      statement_id: params.statementId,
      auto_distill: params.autoDistill ?? true,
      async: params.async,
    };

    if (params.namespace && !params.namespace.includes("/")) {
      payload.project = params.namespace;
    }

    const json = await this.request<any>(path, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (json.accepted) {
      return {
        accepted: true,
        jobId: json.jobId,
        status: json.status,
        outcome: params.outcome,
        attributed: [],
        note: json.note || "Report accepted for background execution.",
      };
    }

    return {
      outcome: json.outcome,
      attributed: json.attributed || [],
      distilledStatement: json.distilledStatement
        ? {
            id: json.distilledStatement.id,
            title: json.distilledStatement.title,
            kind: json.distilledStatement.kind,
            status: json.distilledStatement.status,
            confidence: json.distilledStatement.confidence,
            subject: json.distilledStatement.subject,
          }
        : null,
      note: json.note,
    };
  }

  /**
   * Waits for a background job to complete, streaming progress milestones.
   *
   * @example
   * ```ts
   * const res = await memory.remember({ raw: "...transcript...", async: true });
   * const final = await memory.waitForJob(res.jobId!, {
   *   onProgress: (e) => handleProgress(e.step, e.progress, e.message),
   * });
   * ```
   */
  async waitForJob(jobId: string, options?: WaitForJobOptions): Promise<JobEvent> {
    const timeoutMs = options?.timeoutMs ?? 15000;
    const pollIntervalMs = options?.pollIntervalMs ?? 250;
    const startTime = Date.now();

    // 1. Attempt streaming via GET /api/v1/jobs/:jobId/stream if fetch supports readable streams
    try {
      const url = `${this.baseUrl}/api/v1/jobs/${encodeURIComponent(jobId)}/stream`;
      const authHeader = await this.authManager.getAuthorizationHeader();
      const headers: Record<string, string> = {
        Accept: "text/event-stream",
      };
      if (authHeader) headers.Authorization = authHeader;

      const fetchImpl = this.customFetch ?? fetch;
      const res = await fetchImpl(url, { method: "GET", headers });

      if (res.ok && res.body && typeof (res.body as any).getReader === "function") {
        const reader = (res.body as any).getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          if (Date.now() - startTime > timeoutMs) {
            try {
              await reader.cancel();
            } catch {
              // Ignore reader cancellation errors
            }
            throw new Error(`Job ${jobId} timed out after ${timeoutMs}ms.`);
          }

          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data:")) {
              const jsonStr = trimmed.replace(/^data:\s*/, "");
              try {
                const event = JSON.parse(jsonStr) as JobEvent;
                if (options?.onProgress) {
                  options.onProgress(event);
                }
                if (event.step === "completed") {
                  try {
                    await reader.cancel();
                  } catch {
                    // Ignore reader cancellation errors
                  }
                  return event;
                }
                if (event.step === "failed") {
                  try {
                    await reader.cancel();
                  } catch {
                    // Ignore reader cancellation errors
                  }
                  throw new Error(event.message || `Job ${jobId} failed.`);
                }
              } catch (e) {
                if (e instanceof Error && e.message.includes("Job")) throw e;
              }
            }
          }
        }
      }
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("timed out") || err.message.includes("failed"))
      ) {
        throw err;
      }
      // Fall through to polling
    }

    // 2. Polling fallback
    while (Date.now() - startTime <= timeoutMs) {
      const statusRes = await this.request<{ ok: boolean; job: any }>(
        `/api/v1/jobs/${encodeURIComponent(jobId)}`,
        { method: "GET" },
      ).catch(() => null);

      if (statusRes?.job) {
        const event: JobEvent = {
          step: statusRes.job.step,
          progress: statusRes.job.progress,
          message: statusRes.job.message,
          metadata: statusRes.job.result ?? undefined,
        };

        if (options?.onProgress) {
          options.onProgress(event);
        }

        if (event.step === "completed") {
          return event;
        }
        if (event.step === "failed") {
          throw new Error(event.message || `Job ${jobId} failed.`);
        }
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    throw new Error(`Job ${jobId} timed out after ${timeoutMs}ms.`);
  }

  /**
   * Direct statement outcome evaluation.
   */
  async feedback(params: FeedbackParams): Promise<FeedbackResponse> {
    const path = this.resolveEndpoint(params.namespace, "feedback");

    const payload: Record<string, unknown> = {
      statement_id: params.statementId,
      recall_id: params.recallId,
      outcome: params.outcome,
      reason: params.reason,
      external_ref: params.externalRef,
      payload: params.payload,
    };

    if (params.namespace && !params.namespace.includes("/")) {
      payload.project = params.namespace;
    }

    const json = await this.request<any>(path, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    return {
      outcome: json.outcome,
      attributed: json.attributed || [],
    };
  }

  /**
   * Internal HTTP request handler adding authentication, rate limit resilience, and error parsing.
   */
  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const fetcher = this.customFetch ?? fetch;
    const maxRetries = this.config.maxRetries ?? 3;
    const initialDelay = this.config.initialRetryDelayMs ?? 1000;
    const maxDelay = this.config.maxRetryDelayMs ?? 15000;
    let attempt = 0;

    while (true) {
      const authHeader = await this.authManager.getAuthorizationHeader();
      const headers: Record<string, string> = {
        Authorization: authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers as Record<string, string>),
      };

      const response = await fetcher(`${this.baseUrl}${path}`, {
        ...init,
        headers,
      });

      // Handle soft warning header (299)
      const warningHeader = response.headers.get("RateLimit-Warning");
      if (warningHeader && this.config.onRateLimitWarning) {
        try {
          this.config.onRateLimitWarning(warningHeader, response);
        } catch {
          // Callback exceptions must not break API response execution
        }
      }

      // Handle 429 rate limit with automatic exponential backoff or RateLimitError
      if (response.status === 429) {
        const retryAfterHeader = response.headers.get("Retry-After");
        const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN;

        if (attempt < maxRetries) {
          attempt++;
          const delayMs =
            (!isNaN(retryAfterSec) && retryAfterSec > 0
              ? retryAfterSec * 1000
              : Math.min(maxDelay, initialDelay * Math.pow(2, attempt - 1))) +
            Math.floor(Math.random() * 200);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        // Retries exhausted on 429 -> Throw typed RateLimitError per ADR 057
        const errorJson = (await response.json().catch(() => null)) as {
          error?: string;
          message?: string;
          door?: string;
          limit?: number;
          windowSeconds?: number;
          retryAfter?: number;
        } | null;

        const effectiveRetryAfter =
          !isNaN(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec : (errorJson?.retryAfter ?? 1);

        throw new RateLimitError({
          message:
            errorJson?.message ||
            `Rate limit exceeded${errorJson?.door ? ` on door '${errorJson.door}'` : ""}. Please retry in ${effectiveRetryAfter}s.`,
          door: errorJson?.door,
          limit: errorJson?.limit,
          windowSeconds: errorJson?.windowSeconds,
          retryAfter: effectiveRetryAfter,
          details: errorJson,
        });
      }

      if (!response.ok) {
        const errorJson = (await response.json().catch(() => null)) as {
          error?: string | { message?: string };
          message?: string;
          error_description?: string;
        } | null;

        const message =
          errorJson?.message ||
          (typeof errorJson?.error === "object" ? errorJson.error.message : errorJson?.error) ||
          errorJson?.error_description ||
          response.statusText ||
          `HTTP ${response.status}`;

        const code =
          typeof errorJson?.error === "string"
            ? errorJson.error
            : typeof errorJson?.error === "object"
              ? "api_error"
              : `HTTP_${response.status}`;

        throw new MemCellError(
          `MemCell API Error (${response.status}): ${message}`,
          response.status,
          code,
          errorJson,
        );
      }

      return (await response.json()) as T;
    }
  }

  private resolveEndpoint(
    namespace: string | undefined,
    action: "recall" | "remember" | "report" | "feedback",
  ): string {
    if (namespace && namespace.includes("/")) {
      const [owner, project] = namespace.split("/");
      return `/api/v1/${owner}/${project}/${action}`;
    }
    return `/api/v1/${action}`;
  }
}
