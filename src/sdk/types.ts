export type MemoryKind = "invariant" | "reflex" | "episodic";
export type MemoryStatus = "provisional" | "active" | "pinned" | "decayed" | "refuted";
export type OutcomeVerdict = "worked" | "failed" | "avoided";

export type MemCellAuth =
  | { clientId: string; clientSecret: string; scope?: string }
  | { apiKey: string }
  | { accessToken: string };

export interface MemCellConfig {
  auth: MemCellAuth;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface StatementItem {
  id: string;
  title: string;
  context?: string | null;
  example?: string | null;
  tags?: string[];
  subject?: string | null;
  kind?: MemoryKind;
  status?: MemoryStatus;
  confidence?: number;
  score?: number;
  relevance?: number;
  decayFactor?: number;
  isGuard?: boolean;
  isInvariant?: boolean;
  expiresAt?: string | null;
  createdAt?: string | Date;
}

export interface RecallParams {
  namespace?: string;
  query: string;
  subject?: string | null;
  kind?: MemoryKind | MemoryKind[];
  minConfidence?: number;
  limit?: number;
  tags?: string[];
  format?: "xml" | "markdown" | "none";
  allowProvisional?: boolean;
}

export interface RecallResponse {
  recallId: string;
  promptContext: string;
  statements: StatementItem[];
  matchedTags?: string[];
  guardMode?: "strict" | "advisory";
  profile?: string | null;
}

export interface RememberParams {
  namespace?: string;
  title: string;
  context?: string | null;
  example?: string | null;
  tags?: string[];
  subject?: string | null;
  kind?: MemoryKind;
  status?: MemoryStatus;
  confidence?: number;
  expiresAt?: string | Date | null;
  raw?: string;
  sessionId?: string;
  async?: boolean;
}

export interface RememberResponse {
  created: StatementItem[];
  reinforced?: Array<{ id: string; title: string; confidence?: number }>;
  superseded?: Array<{ id: string; title: string }>;
  note?: string;
  accepted?: boolean;
  jobId?: string;
  status?: string;
}

export interface ReportParams {
  namespace?: string;
  subject?: string | null;
  actionTaken: string;
  outcome: OutcomeVerdict;
  reason?: string | null;
  externalRef?: string | null;
  payload?: Record<string, unknown>;
  recallId?: string;
  statementId?: string;
  autoDistill?: boolean;
  async?: boolean;
}

export interface ReportResponse {
  outcome: OutcomeVerdict;
  attributed: Array<{
    statementId: string;
    title: string;
    from: number;
    to: number;
    evidenceId: string;
  }>;
  distilledStatement?: StatementItem | null;
  note?: string;
  accepted?: boolean;
  jobId?: string;
  status?: string;
}

export interface JobEvent {
  step: "queued" | "distilling" | "embedding" | "reconciling" | "completed" | "failed";
  progress: number;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface WaitForJobOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  onProgress?: (event: JobEvent) => void;
}

export interface FeedbackParams {
  namespace?: string;
  statementId?: string;
  recallId?: string;
  outcome: "worked" | "failed";
  reason?: string | null;
  externalRef?: string | null;
  payload?: Record<string, unknown>;
}

export interface FeedbackResponse {
  outcome: "worked" | "failed";
  attributed: Array<{
    statementId: string;
    title: string;
    from: number;
    to: number;
    evidenceId: string;
  }>;
}

export interface WrapExecutionOptions {
  action: string;
  subject?: string | null;
  kind?: MemoryKind | MemoryKind[];
  minConfidence?: number;
  limit?: number;
  tags?: string[];
  format?: "xml" | "markdown" | "none";
  externalRef?: string | null;
  payload?: Record<string, unknown>;
  autoDistill?: boolean;
}

export interface ScopedExecutionContext {
  promptContext: string;
  statements: StatementItem[];
  recallId: string;
  subject: string | null;
}

export interface ScopedExecutionResult<T> {
  result: T;
  report: ReportResponse;
  recallId: string;
  statements: StatementItem[];
  promptContext: string;
}

export interface ScopeOptions {
  subject?: string | null;
  format?: "xml" | "markdown" | "none";
  minConfidence?: number;
}
