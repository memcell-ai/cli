import { MemCellError } from "@memcell/sdk";
import { credentialFor } from "../instance.js";
import { getSdkClient } from "../sdk-client.js";
import {
  badge,
  bad,
  cmd,
  good,
  id as idSeg,
  label,
  place,
  row,
  say,
  time,
  value,
  variant,
  warn,
} from "../ui.js";

const needsSession = (instance: string) =>
  say(
    row(0, [badge("memcell"), place(instance)]),
    row(1, [warn("not signed in")], [label("run"), cmd("memcell login")]),
  );

function refused(instance: string, failure: Error): number {
  say(
    row(0, [badge("memcell"), place(instance)]),
    row(1, [warn("refused")], [label(failure.message)]),
  );
  return 1;
}

export async function getProfile(instance: string): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const profile = await sdk.account.get();

    say(
      row(0, [badge("memcell"), label("account"), place(instance)]),
      row(
        1,
        [good(profile.name || profile.handle || "user")],
        profile.email ? [label(profile.email)] : null,
        profile.handle ? [variant(`@${profile.handle}`)] : null,
      ),
      row(2, [idSeg(profile.id)]),
      profile.createdAt ? row(2, [label("member since:"), time(String(profile.createdAt))]) : null,
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function updateProfile(
  instance: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const name = typeof flags.name === "string" ? flags.name : undefined;
  if (!name) {
    say(row(0, [bad("missing name")], [label("specify --name <new-name>")]));
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const updated = await sdk.account.updateProfile({ name });

    say(
      row(0, [badge("memcell"), label("account update"), place(instance)]),
      row(1, [good("updated profile name")], [value(updated.name || name)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function listTokens(instance: string): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const tokens = await sdk.account.tokens.list();

    if (tokens.length === 0) {
      say(
        row(0, [badge("memcell"), label("account tokens"), place(instance)]),
        row(1, [label("no personal access tokens")]),
        row(2, [label("create one with"), cmd("memcell account tokens create <name>")]),
      );
      return 0;
    }

    say(
      row(
        0,
        [badge("memcell"), label("account tokens"), place(instance)],
        [variant(`${tokens.length}`)],
      ),
      ...tokens.map((t) =>
        row(
          1,
          [good(t.name)],
          [variant(t.preview)],
          t.expiresAt ? [label("expires:"), time(String(t.expiresAt))] : null,
          [idSeg(t.id)],
        ),
      ),
      row(2, [label("revoke one with"), cmd("memcell account tokens revoke <id>")]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function createToken(
  instance: string,
  name: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  const expiresInDays = typeof flags.expires === "string" ? parseInt(flags.expires, 10) : undefined;

  try {
    const sdk = await getSdkClient(instance);
    const token = await sdk.account.tokens.create({
      name,
      expiresInDays: Number.isFinite(expiresInDays) ? expiresInDays : undefined,
    });

    say(
      row(0, [badge("memcell"), label("account tokens create"), place(instance)]),
      row(1, [good("created token")], [value(token.name)], [idSeg(token.id)]),
      row(2, [label("token:"), value(token.token)]),
      row(2, [label("copy this token now — it will never be displayed again")]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function revokeToken(instance: string, tokenId: string): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    await sdk.account.tokens.revoke(tokenId);

    say(
      row(0, [badge("memcell"), label("account tokens revoke"), place(instance)]),
      row(1, [good("revoked personal token")], [idSeg(tokenId)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}
