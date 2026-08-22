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

/** Open the approval page if this machine can; say so plainly if it cannot. */
function openBrowser(url: string): boolean {
  try {
    // Windows: `start` is cmd's own, its first QUOTED argument is a window
    // title, and an args array with `shell: true` is the exact shape Node
    // deprecated (DEP0190). So: cmd /c start with an empty title and the
    // url quoted verbatim — no shell, nothing for cmd to split on.
    const child =
      process.platform === "win32"
        ? spawn("cmd", ["/c", "start", '""', `"${url}"`], {
            stdio: "ignore",
            detached: true,
            windowsVerbatimArguments: true,
          })
        : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], {
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
  const opened = noBrowser ? false : openBrowser(grant.verification_uri_complete);

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

  const deadline = Date.now() + grant.expires_in * 1000;
  let interval = grant.interval * 1000;

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
