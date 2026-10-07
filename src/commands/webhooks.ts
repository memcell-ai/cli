import { MemCellError } from "@memcell/sdk";
import { credentialFor } from "../instance.js";
import { resolveNamespace } from "../namespace.js";
import { getSdkClient } from "../sdk-client.js";
import {
  bad,
  badge,
  cmd,
  emit,
  good,
  id as idSeg,
  label,
  place,
  row,
  say,
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

export async function listWebhooks(
  instance: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const target =
      typeof flags.workspace === "string" ? flags.workspace : (flags.project as string | undefined);
    const namespace = await resolveNamespace(sdk, target);

    const webhooks = await sdk.webhooks.list(namespace);

    if (flags.json === true) {
      emit(JSON.stringify(webhooks, null, 2) + "\n");
      return 0;
    }

    if (webhooks.length === 0) {
      say(
        row(0, [badge("memcell"), label("webhook"), place(namespace)]),
        row(
          1,
          [label("no webhooks configured")],
          [label("create one with"), cmd("memcell webhook new <name> <url>")],
        ),
      );
      return 0;
    }

    say(
      row(
        0,
        [badge("memcell"), label("webhook"), place(namespace)],
        [variant(`${webhooks.length} webhook${webhooks.length === 1 ? "" : "s"}`)],
      ),
      ...webhooks.map((w: any) =>
        row(
          1,
          [w.enabled ? good(w.name) : warn(w.name)],
          [w.enabled ? variant("enabled") : variant("disabled")],
          [value(w.url)],
          [label(w.events.join(","))],
          [idSeg(w.id)],
        ),
      ),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function getWebhook(
  instance: string,
  webhookId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const target =
      typeof flags.workspace === "string" ? flags.workspace : (flags.project as string | undefined);
    const namespace = await resolveNamespace(sdk, target);

    const webhook = await sdk.webhooks.get(namespace, webhookId);

    if (flags.json === true) {
      emit(JSON.stringify(webhook, null, 2) + "\n");
      return 0;
    }

    say(
      row(0, [badge("memcell"), label("webhook"), place(namespace)], [idSeg(webhookId)]),
      row(1, [good(webhook.name)], [webhook.enabled ? variant("enabled") : variant("disabled")]),
      row(2, [label("destination URL:")], [value(webhook.url)]),
      row(2, [label("subscribed events:")], [value(webhook.events.join(", "))]),
      webhook.secret ? row(2, [label("HMAC secret:"), variant("configured")]) : null,
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function createWebhook(
  instance: string,
  name: string,
  url: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const target =
      typeof flags.workspace === "string" ? flags.workspace : (flags.project as string | undefined);
    const namespace = await resolveNamespace(sdk, target);

    const secret = typeof flags.secret === "string" ? flags.secret : undefined;
    const events =
      typeof flags.events === "string"
        ? flags.events
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
    const enabled = flags.disabled !== true;

    const created = await sdk.webhooks.create(namespace, {
      name,
      url,
      secret,
      events,
      enabled,
    });

    if (flags.json === true) {
      emit(JSON.stringify(created, null, 2) + "\n");
      return 0;
    }

    say(
      row(0, [badge("memcell"), label("webhook create"), place(namespace)]),
      row(1, [good("registered webhook")], [value(created.name)], [variant(created.url)]),
      row(2, [idSeg(created.id)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function updateWebhook(
  instance: string,
  webhookId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const target =
      typeof flags.workspace === "string" ? flags.workspace : (flags.project as string | undefined);
    const namespace = await resolveNamespace(sdk, target);

    const name = typeof flags.name === "string" ? flags.name : undefined;
    const url = typeof flags.url === "string" ? flags.url : undefined;
    const secret = typeof flags.secret === "string" ? flags.secret : undefined;
    const events =
      typeof flags.events === "string"
        ? flags.events
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
    const enabled = flags.enable === true ? true : flags.disable === true ? false : undefined;

    const updated = await sdk.webhooks.update(namespace, webhookId, {
      name,
      url,
      secret,
      events,
      enabled,
    });

    if (flags.json === true) {
      emit(JSON.stringify(updated, null, 2) + "\n");
      return 0;
    }

    say(
      row(0, [badge("memcell"), label("webhook update"), place(namespace)]),
      row(1, [good("updated webhook")], [value(updated.name)]),
      row(2, [idSeg(updated.id)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function deleteWebhook(
  instance: string,
  webhookId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const target =
      typeof flags.workspace === "string" ? flags.workspace : (flags.project as string | undefined);
    const namespace = await resolveNamespace(sdk, target);

    await sdk.webhooks.delete(namespace, webhookId);

    say(
      row(0, [badge("memcell"), label("webhook delete"), place(namespace)]),
      row(1, [good("deleted webhook")], [idSeg(webhookId)]),
    );
    return 0;
  } catch (error) {
    return refused(instance, error as Error);
  }
}

export async function pingWebhook(
  instance: string,
  webhookId: string,
  flags: Record<string, string | true> = {},
): Promise<number> {
  if (!(await credentialFor(instance))) {
    needsSession(instance);
    return 1;
  }

  try {
    const sdk = await getSdkClient(instance);
    const target =
      typeof flags.workspace === "string" ? flags.workspace : (flags.project as string | undefined);
    const namespace = await resolveNamespace(sdk, target);

    const res = await sdk.webhooks.ping(namespace, webhookId);

    if (flags.json === true) {
      emit(JSON.stringify(res, null, 2) + "\n");
      return 0;
    }

    if (res.ok) {
      say(
        row(0, [badge("memcell"), label("webhook ping"), place(namespace)], [idSeg(webhookId)]),
        row(1, [good("ping delivered")], [value(`${res.statusCode} ${res.statusText}`)]),
      );
      return 0;
    } else {
      say(
        row(0, [badge("memcell"), label("webhook ping"), place(namespace)], [idSeg(webhookId)]),
        row(
          1,
          [bad("ping failed")],
          [value(`${res.statusCode} ${res.statusText || res.error || ""}`)],
        ),
      );
      return 1;
    }
  } catch (error) {
    return refused(instance, error as Error);
  }
}
