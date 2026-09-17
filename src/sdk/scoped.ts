import type {
  FeedbackParams,
  FeedbackResponse,
  JobEvent,
  RecallParams,
  RecallResponse,
  RememberParams,
  RememberResponse,
  ReportParams,
  ReportResponse,
  ScopeOptions,
  ScopedExecutionContext,
  ScopedExecutionResult,
  WaitForJobOptions,
  WrapExecutionOptions,
} from "./types.js";
import type { MemCell } from "./client.js";

export class ScopedMemCell {
  readonly defaultSubject: string | null;
  readonly defaultFormat: "xml" | "markdown" | "none";

  constructor(
    private readonly client: MemCell,
    readonly namespace: string,
    options?: ScopeOptions,
  ) {
    this.defaultSubject = options?.subject ?? null;
    this.defaultFormat = options?.format ?? "xml";
  }

  /**
   * Pre-flight recall from the scoped memory container.
   */
  async recall(
    query: string,
    options?: Omit<RecallParams, "namespace" | "query">,
  ): Promise<RecallResponse> {
    return await this.client.recall({
      namespace: this.namespace,
      query,
      subject: options?.subject !== undefined ? options.subject : this.defaultSubject,
      format: options?.format ?? this.defaultFormat,
      ...options,
    });
  }

  /**
   * Direct addition of durable statements to the scoped memory container.
   */
  async remember(statement: Omit<RememberParams, "namespace">): Promise<RememberResponse> {
    return await this.client.remember({
      namespace: this.namespace,
      subject: statement.subject !== undefined ? statement.subject : this.defaultSubject,
      ...statement,
    });
  }

  /**
   * Post-flight execution reporting & dynamic reflex reinforcement.
   */
  async report(params: Omit<ReportParams, "namespace">): Promise<ReportResponse> {
    return await this.client.report({
      namespace: this.namespace,
      subject: params.subject !== undefined ? params.subject : this.defaultSubject,
      ...params,
    });
  }

  /**
   * Direct statement outcome feedback.
   */
  async feedback(params: Omit<FeedbackParams, "namespace">): Promise<FeedbackResponse> {
    return await this.client.feedback({
      namespace: this.namespace,
      ...params,
    });
  }

  /**
   * Automated execution wrapper implementing the complete Dynamic Agentic Loop:
   * 1. Pre-Flight Recall: Queries relevant invariants and learned reflexes for the action.
   * 2. In-Flight Execution: Runs the agent callback with promptContext and statements.
   * 3. Post-Flight Reinforcement: Automatically reports outcome ('worked' on resolution, 'failed' on exception)
   *    and attributes feedback before re-throwing any error.
   */
  async wrapExecution<T>(
    options: WrapExecutionOptions,
    actionFn: (context: ScopedExecutionContext) => Promise<T>,
  ): Promise<ScopedExecutionResult<T>> {
    const targetSubject = options.subject !== undefined ? options.subject : this.defaultSubject;
    const format = options.format ?? this.defaultFormat;

    // 1. Pre-Flight Recall
    const recallResult = await this.recall(options.action, {
      subject: targetSubject,
      kind: options.kind,
      minConfidence: options.minConfidence,
      limit: options.limit,
      tags: options.tags,
      format,
    });

    const executionContext: ScopedExecutionContext = {
      promptContext: recallResult.promptContext,
      statements: recallResult.statements,
      recallId: recallResult.recallId,
      subject: targetSubject,
    };

    // 2. In-Flight Execution
    let result: T;
    try {
      result = await actionFn(executionContext);
    } catch (err) {
      // 3a. Post-Flight Report on Error
      const errorMessage = err instanceof Error ? err.message : String(err);
      try {
        await this.report({
          actionTaken: options.action,
          outcome: "failed",
          recallId: recallResult.recallId,
          subject: targetSubject,
          reason: errorMessage,
          externalRef: options.externalRef,
          payload: options.payload,
          autoDistill: options.autoDistill,
        });
      } catch {
        // Do not suppress the original execution exception
      }
      throw err;
    }

    // 3b. Post-Flight Report on Success
    const reportResult = await this.report({
      actionTaken: options.action,
      outcome: "worked",
      recallId: recallResult.recallId,
      subject: targetSubject,
      externalRef: options.externalRef,
      payload: options.payload,
      autoDistill: options.autoDistill,
    });

    return {
      result,
      report: reportResult,
      recallId: recallResult.recallId,
      statements: recallResult.statements,
      promptContext: recallResult.promptContext,
    };
  }

  /**
   * Waits for an asynchronous background job to complete.
   */
  async waitForJob(jobId: string, options?: WaitForJobOptions): Promise<JobEvent> {
    return await this.client.waitForJob(jobId, options);
  }
}
