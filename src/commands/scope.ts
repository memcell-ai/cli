import { MemCellError } from "@memcell/sdk";
import { MemcellError } from "../client.js";
import { getSdkClient } from "../sdk-client.js";
import { badge, bad, label, place, row, say, variant } from "../ui.js";
import { wired } from "./wired.js";

// `memcell scope` — list active operational scopes and memory
// counts in the currently wired workspace.

export async function scope(url?: string): Promise<number> {
  const here = await wired("scope", url);
  if (!here) return 1;

  try {
    const sdk = await getSdkClient(here.instance, { bearer: here.key });
    const scopesList = await sdk.scopes.list(here.space.includes("/") ? here.space : undefined);

    if (scopesList.length === 0) {
      say(
        row(0, [badge("memcell"), label("scope"), place(here.space)]),
        row(1, [label("no active scopes established yet")]),
      );
      return 0;
    }

    say(
      row(
        0,
        [badge("memcell"), label("scope"), place(here.space)],
        [variant(scopesList.length === 1 ? "1 active" : `${scopesList.length} active`)],
      ),
      ...scopesList.map((s) =>
        row(
          1,
          [variant((s as any).name || (s as any).scope)],
          [label(s.count === 1 ? "1 memory" : `${s.count} memories`)],
        ),
      ),
    );
    return 0;
  } catch (error) {
    if (error instanceof MemcellError || error instanceof MemCellError) {
      say(
        row(0, [badge("memcell"), label("scope")]),
        row(1, [bad("refused")], [label(error.message)]),
      );
      return 1;
    }
    throw error;
  }
}

export const scopes = scope;
