import { call, MemcellError } from "../client.js";
import { credentialFor, forgetCredential } from "../instance.js";
import { badge, good, label, place, row, say, variant, warn } from "../ui.js";

// The exact inverse of `login`, and nothing more: end the session on the
// instance, then forget it here. It leaves linked projects alone, because
// they are not what signing in created — `hook remove` undoes those, one
// directory at a time.
//
// If the instance cannot be reached the local credential still goes. A
// machine you are walking away from should not keep a token because the
// network was down.

export async function logout(instance: string): Promise<number> {
  const credential = await credentialFor(instance);
  if (!credential) {
    say(
      row(0, [badge("memcell"), place(instance)]),
      row(1, [label("not connected")], [label("nothing to sign out of")]),
    );
    return 0;
  }

  let revoked = true;
  let remoteFailure: string | null = null;
  try {
    await call(instance, "/api/auth/sign-out", { method: "POST", body: {} });
  } catch (error) {
    revoked = false;
    remoteFailure = (error as MemcellError).message;
  }

  await forgetCredential(instance);
  say(
    row(0, [badge("memcell"), place(instance)]),
    row(1, [good("signed out")], !revoked && [variant("local only")]),
    remoteFailure ? row(2, [warn("the instance was not reached")], [label(remoteFailure)]) : null,
  );
  return 0;
}
