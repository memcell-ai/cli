import { MemCellError } from "@memcell/sdk";
import { MemcellError } from "../client.js";
import { credentialFor, resolveInstance } from "../instance.js";
import { resolveNamespace } from "../namespace.js";
import { getSdkClient } from "../sdk-client.js";
import { badge, bad, good, label, place, row, say, value, warn } from "../ui.js";
import { wired } from "./wired.js";

// `memcell report <memory> <outcome>` — what happened when somebody acted
// on a served memory. The only thing that moves confidence, which is why
// a memory's confidence is earned rather than asserted.

const OUTCOMES = ["worked", "failed", "avoided"] as const;

export async function report(
  memoryId: string,
  outcome: string,
  note?: string,
  url?: string,
  flags?: Record<string, any>,
): Promise<number> {
  if (!(OUTCOMES as readonly string[]).includes(outcome as any)) {
    say(
      row(0, [badge("memcell"), label("report")]),
      row(1, [warn(`no outcome called ${outcome}`)], [value(OUTCOMES.join(" · "))]),
    );
    return 1;
  }

  const explicitWs = typeof flags?.workspace === "string" ? flags.workspace : undefined;

  let instanceUrl: string;
  let bearerToken: string | undefined;
  let targetSpace: string;
  let targetNamespace: string | undefined;

  if (explicitWs) {
    instanceUrl = await resolveInstance(url);
    const cred = await credentialFor(instanceUrl);
    if (!cred) {
      say(
        row(0, [badge("memcell"), bad("report")]),
        row(1, [bad("not signed in")], [label("run memcell login or set MEMCELL_API_KEY")]),
      );
      return 1;
    }
    bearerToken = cred.token;
    targetSpace = explicitWs;
    const tempSdk = await getSdkClient(instanceUrl, { bearer: bearerToken });
    targetNamespace = await resolveNamespace(tempSdk, explicitWs).catch(() => explicitWs);
  } else {
    const here = await wired("report", url);
    if (!here) return 1;
    instanceUrl = here.instance;
    bearerToken = here.key;
    targetSpace = here.space;
  }

  try {
    const sdk = await getSdkClient(instanceUrl, { bearer: bearerToken });
    const feedbackPayload: any = {
      memoryId,
      outcome: outcome as any,
    };
    if (targetNamespace) {
      feedbackPayload.workspace = targetNamespace;
      feedbackPayload.namespace = targetNamespace;
    }
    if (note !== undefined) {
      feedbackPayload.note = note;
    }
    const moved = (await (sdk.feedback
      ? sdk.feedback(feedbackPayload)
      : (sdk as any).report(feedbackPayload))) as any;
    const fromNum: number =
      typeof moved?.from === "number" ? moved.from : (moved?.attributed?.[0]?.from ?? 0.5);
    const toNum: number =
      typeof moved?.to === "number" ? moved.to : (moved?.attributed?.[0]?.to ?? 0.6);
    say(
      row(0, [badge("memcell"), label("report"), place(targetSpace)]),
      row(
        1,
        [good(outcome)],
        [label("confidence"), value(`${fromNum.toFixed(2)} → ${toNum.toFixed(2)}`)],
      ),
    );
    return 0;
  } catch (error) {
    if (error instanceof MemcellError || error instanceof MemCellError) {
      say(
        row(0, [badge("memcell"), label("report")]),
        row(1, [bad("refused")], [label(error.message)]),
      );
      return 1;
    }
    throw error;
  }
}
