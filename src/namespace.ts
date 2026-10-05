import type { MemCell } from "@memcell/sdk";
import { get } from "./config.js";
import { findWorkspace, type Workspace } from "./workspace.js";

/**
 * Resolves the full "owner/project" namespace for API operations.
 * Priority order:
 * 1. Explicit target if it already contains "/" (e.g. "acme/backend")
 * 2. Connected project owner + target/slug (e.g. "acme/backend")
 * 3. Active CLI organization context + target/slug
 * 4. Authenticated account profile handle/slug + target/slug
 */
export async function resolveNamespace(
  sdk: MemCell,
  explicitTarget?: string,
  foundProject?: { project: Workspace; at: string } | null,
): Promise<string> {
  const target = explicitTarget?.trim();
  if (target && target.includes("/")) {
    return target;
  }

  const projectObj =
    foundProject !== undefined ? foundProject : await findWorkspace().catch(() => null);
  const proj = projectObj?.project;
  const slug = target || proj?.workspace || proj?.project || proj?.space;

  if (!slug) {
    throw new Error("No project specified and no connected project found in this directory.");
  }

  if (slug.includes("/")) {
    return slug;
  }

  if (proj?.owner) {
    return `${proj.owner}/${slug}`;
  }

  const activeOrg = (await get("organization"))?.value as string | undefined;
  if (activeOrg) {
    return `${activeOrg}/${slug}`;
  }

  try {
    const profile = await sdk.account.get();
    const owner = profile.handle || profile.id;
    if (owner) {
      return `${owner}/${slug}`;
    }
  } catch {
    // Fall back to target if account profile cannot be fetched
  }

  return slug;
}
