import { spawn } from "node:child_process";

import { call, type MemcellError } from "./client.js";
import { saveCredential } from "./instance.js";
import { bad, cmd, label, place, row, say, value, variant, warn, badge } from "./ui.js";

// The standard device grant (RFC 8628), shared by every command that needs
// this machine signed in: ask for a code, show it, let a human approve it
// in a browser — anonymous or signed in — then exchange it for a session
// this machine can spend. `login` is this and a report; bare `connect` is
// this and then the key.

const CLIENT_ID = "memcell-cli";

interface Grant {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface Token {
  access_token: string;
  token_type: string;
}

/**
 * Open the approval page if this machine can; say so plainly if it cannot.
 *
 * The URL comes from the INSTANCE, over the wire, and on Windows it is
 * handed to `cmd`. A `--instance` pointed at a hostile or compromised host
 * could therefore choose what a person's shell runs. So it is parsed before
 * it is spawned, must be http(s), and must belong to the instance the
 * person named — a device grant that sends you somewhere else is not a
 * device grant.
 */
export function openBrowserTarget(url: string, instance: string): string | null {
  let target: URL;
  let home: URL;
  try {
    target = new URL(url);
    home = new URL(instance);
  } catch {
    return null;
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") return null;
  if (target.origin !== home.origin) return null;
  // Serialised, not the raw string: URL encoding escapes quotes and the
  // characters a command line would otherwise treat as its own.
  return target.href;
}

function openBrowser(url: string, instance: string): boolean {
  const safe = openBrowserTarget(url, instance);
  if (!safe) return false;
  try {
    // Windows: `start` is cmd's own, its first QUOTED argument is a window
    // title, and an args array with `shell: true` is the exact shape Node
    // deprecated (DEP0190). So: cmd /c start with an empty title and the
    // url quoted verbatim — no shell, nothing for cmd to split on.
    const child =
      process.platform === "win32"
        ? spawn("cmd", ["/c", "start", '""', `"${safe}"`], {
            stdio: "ignore",
            detached: true,
            windowsVerbatimArguments: true,
          })
        : spawn(process.platform === "darwin" ? "open" : "xdg-open", [safe], {
            stdio: "ignore",
            detached: true,
          });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run the grant to a saved credential. Prints the code, the page, and every
 * ending in the terminal's own voice; the caller only needs the outcome.
 * `retry` is what to tell somebody to run again on an expired code — the
 * command they are actually in.
 */
export async function deviceGrant(
  instance: string,
  options: { noBrowser?: boolean; retry: string },
): Promise<boolean> {
  let grant: Grant;
  try {
    grant = await call<Grant>(instance, "/api/auth/device/code", {
      method: "POST",
      anonymous: true,
      body: { client_id: CLIENT_ID, scope: "memory" },
    });
  } catch (error) {
    say(
      row(0, [badge("memcell"), place(instance)]),
      row(1, [bad("unreachable")], [label((error as MemcellError).message)]),
    );
    return false;
  }

  // Headless boxes, CI, and anyone who would rather paste the link than
  // have a window thrown at them.
  const noBrowser =
    options.noBrowser || Boolean(process.env.MEMCELL_NO_BROWSER) || Boolean(process.env.CI);
  const opened = noBrowser ? false : openBrowser(grant.verification_uri_complete, instance);

  say(
    row(0, [badge("memcell"), place(instance)], [variant("connecting")]),
    row(1, [label("code"), value(grant.user_code)], [label("at"), place(grant.verification_uri)]),
    row(2, [
      label(
        opened
          ? "opening your browser — approve there and this will continue"
          : "open that page on any device (phone included) and enter the code",
      ),
    ]),
    // The code belongs to whichever browser opens it first, so say which
    // one to finish in rather than letting a second window fail obscurely.
    opened && row(2, [label("finish in the window that opened")]),
  );

  // Clamped, because these two numbers come from the instance and drive a
  // loop. A malformed or hostile body — `expires_in: null`, `interval: 0` —
  // otherwise turns approval into an unbounded hot loop against the token
  // endpoint, from the person's own machine.
  const seconds = Number(grant.expires_in);
  const paceSeconds = Number(grant.interval);
  const deadline =
    Date.now() + (Number.isFinite(seconds) ? Math.min(Math.max(seconds, 60), 1800) : 900) * 1000;
  let interval = (Number.isFinite(paceSeconds) ? Math.min(Math.max(paceSeconds, 1), 30) : 5) * 1000;

  for (;;) {
    await wait(interval);
    if (Date.now() > deadline) {
      say(row(1, [warn("the code expired")], [label("run"), cmd(options.retry), label("again")]));
      return false;
    }

    try {
      const token = await call<Token>(instance, "/api/auth/device/token", {
        method: "POST",
        anonymous: true,
        body: {
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: grant.device_code,
          client_id: CLIENT_ID,
        },
      });

      await saveCredential({
        instance,
        token: token.access_token,
        obtainedAt: new Date().toISOString(),
      });
      return true;
    } catch (error) {
      const failure = error as MemcellError;
      const code = (failure.body as { error?: string } | null)?.error;

      if (code === "authorization_pending") continue;
      // The server sets the pace; being told to slow down is not a failure.
      if (code === "slow_down") {
        interval += 5000;
        continue;
      }
      if (code === "access_denied") {
        say(row(1, [warn("denied in the browser")], [label("nothing was connected")]));
        return false;
      }
      if (code === "expired_token") {
        say(row(1, [warn("the code expired")], [label("run"), cmd(options.retry), label("again")]));
        return false;
      }
      say(row(1, [warn("refused")], [label(failure.message)]));
      return false;
    }
  }
}
