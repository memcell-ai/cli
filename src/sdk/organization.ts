import type { MemCell } from "./client.js";
import type { ScopedMemCell } from "./scoped.js";
import type {
  FeedbackParams,
  FeedbackResponse,
  RecallParams,
  RecallResponse,
  RememberParams,
  RememberResponse,
  ReportParams,
  ReportResponse,
  ScopeOptions,
} from "./types.js";

/**
 * Organization-scoped MemCell handle providing memory operations bound to an organization namespace.
 */
export class OrganizationMemCell {
  readonly memcell: MemCell;
  readonly orgSlug: string;

  constructor(memcell: MemCell, orgSlug: string) {
    this.memcell = memcell;
    this.orgSlug = orgSlug.toLowerCase().trim();
  }

  /**
   * Creates a scoped handle bound to a specific project within this organization.
   *
   * @example
   * ```ts
   * const acmeDevops = acmeMemory.scope("devops", { subject: "pipeline:deploy" });
   * const context = await acmeDevops.recall({ query: "deployment checklists" });
   * ```
   */
  scope(projectSlug: string, options?: ScopeOptions): ScopedMemCell {
    const cleanProject = projectSlug.startsWith(`${this.orgSlug}/`)
      ? projectSlug
      : `${this.orgSlug}/${projectSlug}`;
    return this.memcell.scope(cleanProject, options);
  }

  /**
   * Semantic alias for `scope(projectSlug, options)`.
   */
  forProject(projectSlug: string, options?: ScopeOptions): ScopedMemCell {
    return this.scope(projectSlug, options);
  }

  /**
   * Recall statements scoped to this organization.
   */
  async recall(params: RecallParams): Promise<RecallResponse> {
    return this.memcell.recall({
      ...params,
      namespace: this.qualifyNamespace(params.namespace),
    });
  }

  /**
   * Remember statements scoped to this organization.
   */
  async remember(params: RememberParams): Promise<RememberResponse> {
    return this.memcell.remember({
      ...params,
      namespace: this.qualifyNamespace(params.namespace),
    });
  }

  /**
   * Report execution outcome scoped to this organization.
   */
  async report(params: ReportParams): Promise<ReportResponse> {
    return this.memcell.report({
      ...params,
      namespace: this.qualifyNamespace(params.namespace),
    });
  }

  /**
   * Submit feedback scoped to this organization.
   */
  async feedback(params: FeedbackParams): Promise<FeedbackResponse> {
    return this.memcell.feedback({
      ...params,
      namespace: this.qualifyNamespace(params.namespace),
    });
  }

  private qualifyNamespace(ns?: string): string {
    if (!ns) return this.orgSlug;
    if (ns === this.orgSlug || ns.startsWith(`${this.orgSlug}/`)) return ns;
    return `${this.orgSlug}/${ns}`;
  }
}
