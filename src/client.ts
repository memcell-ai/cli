import { credentialFor } from "./instance.js";

// The one way this package talks to a memcell. Every request carries the
// instance's own session as a bearer token, because a terminal has no
// cookie jar — which is exactly what the device grant hands back.

export class MemcellError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "MemcellError";
  }
}

interface CallOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Skip the stored session — the device grant's own calls are unauthenticated. */
  anonymous?: boolean;
  /** Call as this credential instead of the machine's login session. A
   *  connected directory holds a pair key that already names its space, so a
   *  space-scoped verb run there needs no login at all. */
  bearer?: string;
  signal?: AbortSignal;
  /** Milliseconds before the call gives up. A caller with its own deadline
   *  passes `signal` instead. */
  timeoutMs?: number;
}

/** How long a person waits before an unanswered instance is a failure
 *  rather than a wait. The hooks carry their own, tighter, budgets; this is
 *  for the commands somebody typed. */
const CALL_TIMEOUT_MS = 30_000;

export async function call<T>(
  instance: string,
  path: string,
  { method = "GET", body, anonymous, bearer, signal, timeoutMs }: CallOptions = {},
): Promise<T> {
  // An instance that accepts the connection and never answers would
  // otherwise hang the terminal forever, with nothing printed. Every call
  // gets a deadline unless its caller brought one.
  const deadline = signal ? undefined : AbortSignal.timeout(timeoutMs ?? CALL_TIMEOUT_MS);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // Same-origin rules do not apply to a terminal, but the server checks
    // for an origin it trusts before it will act on a state change.
    origin: instance,
    accept: "application/json",
  };

  if (bearer) {
    headers.authorization = `Bearer ${bearer}`;
  } else if (!anonymous) {
    const credential = await credentialFor(instance);
    if (credential) headers.authorization = `Bearer ${credential.token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${instance}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? deadline,
    });
  } catch (cause) {
    // A timeout and a refused connection are different facts, and the
    // difference is what somebody debugs on: one means the instance is not
    // there, the other that it is there and not answering.
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    throw new MemcellError(
      timedOut ? `${instance} did not answer in time.` : `Could not reach ${instance}.`,
      0,
      cause,
    );
  }

  // The body may not be JSON — a wrong instance answers with an HTML page, a
  // proxy with plain text, a gateway with nothing. Parsing is tried, never
  // assumed: a raw "Unexpected token '<'" is the parser leaking through, not
  // an error a person can act on.
  const text = await response.text();
  let parsed: unknown = null;
  let isJson = false;
  if (text) {
    try {
      parsed = JSON.parse(text);
      isJson = true;
    } catch {
      // Left as not-JSON; handled below with the status.
    }
  }

  if (!response.ok) {
    const detail = parsed as { error_description?: string; message?: string } | null;
    throw new MemcellError(
      detail?.error_description ??
        detail?.message ??
        (isJson
          ? `${response.status} from ${path}`
          : `${instance} answered ${response.status}, not memcell — check the address.`),
      response.status,
      parsed,
    );
  }

  if (text && !isJson) {
    // A 200 that is not data: usually the address is a website, not an
    // instance — the connect page's own HTML, say.
    throw new MemcellError(
      `${instance} did not answer as a memcell instance — check the address.`,
      response.status,
      text,
    );
  }

  return parsed as T;
}

export interface Session {
  user: { id: string; name: string; email: string; isAnonymous?: boolean };
}

/** Who this machine is, as far as the instance is concerned. */
/** What an agent KEY is, and whether it can still work.
 *
 *  A different question from `whoami`, which answers for the person's
 *  session. The two credentials fail independently: a session stays live for
 *  a week while every hook on the machine is being turned away, and
 *  `memcell status` reported the healthy one.
 */
export interface AgentStanding {
  agent: string | null;
  space: string | null;
  standing: "ok" | "over_ceiling" | "suspended" | "revoked";
  calls: { used: number; ceiling: number; resetsAt: string };
  says: string | null;
}

export async function agentStanding(instance: string, key: string): Promise<AgentStanding> {
  return call<AgentStanding>(instance, "/api/v1/agent", { bearer: key });
}

export async function whoami(instance: string): Promise<Session | null> {
  const session = await call<Session | null>(instance, "/api/auth/get-session");
  return session?.user ? session : null;
}

/** An SSE stream from the instance, yielded event by event. The terminal
 *  watches work the same way the console does — one long-lived connection
 *  the server writes to — rather than asking the same question on a timer. */
export async function* stream(
  instance: string,
  path: string,
  signal?: AbortSignal,
): AsyncGenerator<{ event: string; data: string }> {
  const headers: Record<string, string> = { accept: "text/event-stream", origin: instance };
  const credential = await credentialFor(instance);
  if (credential) headers.authorization = `Bearer ${credential.token}`;

  const response = await fetch(`${instance}${path}`, { headers, signal }).catch(
    (cause: unknown) => {
      throw new MemcellError(`Could not reach ${instance}.`, 0, cause);
    },
  );
  if (!response.ok || !response.body) {
    throw new MemcellError(`Stream refused (${response.status}).`, response.status, null);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    // Events are separated by a blank line; anything after the last one is
    // a partial frame and waits for the next chunk.
    let split: number;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      let event = "message";
      let data = "";
      for (const raw of frame.split("\n")) {
        if (raw.startsWith("event:")) event = raw.slice(6).trim();
        else if (raw.startsWith("data:")) data += raw.slice(5).trim();
      }
      if (data) yield { event, data };
    }
  }
}
