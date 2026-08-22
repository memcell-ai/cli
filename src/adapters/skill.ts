import { mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The shared skill — the prompt-level surface of the loop, written ONCE.
//
// Nearly every agent reads `.agents/skills/`, so one file reaches most of
// them; that is a reach point, not a dependency. The skill teaches the four
// legs the other surfaces already carry — MCP is the model's reach, hooks
// are the harness's enforcement — so it is reinforcement, never
// load-bearing: an agent that ignores it still has the whole loop. A
// capture or serving failure is the engine's judgement to improve, never an
// instruction to add here.

const SKILL_DIR = [".agents", "skills", "memcell"];

/** The whole skill. Only doors that exist are named — the four MCP tools by
 *  their registered names, and the one CLI command a person types. */
const SKILL = `---
name: memcell
description: Living memory for this project and the libraries it uses. Recall before acting — it carries what was established here (decisions, conventions, dead ends) braided with continuously-updated memories of the open-source world your training data ended before, every claim carrying confidence earned from reported outcomes rather than asserted. Use at the start of any non-trivial task, before writing against an API you believe you already know, whenever an approach fails or a decision is made, and whenever a document carries decisions. Report outcomes afterwards — a memory never told what happened stops learning.
---

# memcell

Memory your agents recall from before they act, and report back to
afterwards. Two things braided into one answer:

- **This project** — decisions, conventions, gotchas and dead ends
  established while working here. Filed from real work, not authored by
  hand.
- **The open world** — continuously-seeded memories of libraries,
  frameworks and docs, tracking what is true _now_ rather than at your
  training cutoff.

Every entry is one claim, carrying the evidence behind it and a confidence
figure that moves only when outcomes are reported: what worked rises, what
failed falls. That is the difference from an instruction file, which is
written once and never sharpened by what happened.

## How to reach it

Two ways, and either is enough.

**Tools** named \`recall\`, \`remember\`, \`ingest\`, and \`report\`. Use them if
they are there.

**The shell**, otherwise — same doors, same memory:

\`\`\`
memcell recall "<what you are trying to do or know>"
memcell remember "<one claim, in one sentence>"
memcell report <statement-id> worked|failed
memcell ingest <file>
\`\`\`

If those commands are missing, run them through \`npx memcell\` instead. If
they answer \`not wired\`, this directory has no memory yet: tell the user
once, give them \`npx memcell connect\`, and carry on without it.

Never invent a memory tool, and never keep memory in a file of your own.

## recall — before you implement

Ask with the task in your own words: an intent or a question, not keywords.

\`\`\`
memcell recall "how should retries behave when the payment gateway times out?"
memcell recall "is this ORM's transaction API still the current one?"
\`\`\`

Do this at the start of a task, not after writing code — and again before
writing against a library API you are recalling from training rather than
reading. Each answer carries a confidence figure and the id you need to
report on it.

**Reading a result:**

- **0.7 and above** — the project's current position. Follow it, or state
  plainly why you are departing from it.
- **below 0.7** — a lead. Weigh it against what you find in the code.
- **\`dead_end\`** — an approach already tried and failed here. Do not retry
  it silently. If you believe it no longer applies, say so first, then go
  through it deliberately.
- **\`layer: public\`** — from the open-source commons, kept current. Where it
  contradicts what you remember about a library, it is the later source.
- **\`pinned\`** — a standing rule, present whatever you asked. It did not
  answer your question; do not read its presence as relevance.

Nothing served means nothing is established here yet. That is an answer:
proceed, and file what you learn.

## remember — when something is established

One claim, one sentence, when work settles something durable that a
transcript would bury.

\`\`\`
memcell remember "Retries cap at five attempts; after that the job parks in the dead-letter table."
memcell remember "Polling the gateway for capture status times out under load." --kind gotcha
\`\`\`

File decisions, constraints discovered, and approaches that failed. Do not
file activity ("fixed the retry bug"), restatements of code, or anything
\`git log\` already carries.

## report — what makes the figures real

When something memory served turns out to have worked or failed, say so
against its id:

\`\`\`
memcell report 941435d1-36da-4611-9a41-8e410d2af25a worked
memcell report 941435d1-36da-4611-9a41-8e410d2af25a failed --note "the cap did not hold under load"
\`\`\`

This is the only thing that moves confidence, and it is what separates this
from a notes file. A recall nobody reports on teaches the record nothing,
and stale confidence is worse than none.

Report \`failed\` when your work contradicts a served statement — and say so
in the conversation too, rather than silently overriding it.

## ingest — when a document carries decisions

Hand specs, ADRs, and runbooks over whole:

\`\`\`
memcell ingest docs/adr/012-retry-policy.md
\`\`\`

Do not summarize the document yourself — it is distilled into individual
claims, each keeping provenance back to what it came from.

## While you work

In a wired project, hooks already recall at session start and capture the
turn's material at the end, so routine work needs no filing from you. The
calls above are what you reach for mid-turn: recall before deciding, report
when an outcome lands.
`;

/** Drop (or refresh) the shared skill. The file is wholly memcell's, so a
 *  rewrite is always safe — its content is versioned by this build, not by
 *  hand edits. */
export function installSkill(projectDir: string): string {
  const dir = join(projectDir, ...SKILL_DIR);
  mkdirSync(dir, { recursive: true });
  const at = join(dir, "SKILL.md");
  writeFileSync(at, SKILL);
  return at;
}

/** A directory the drop created leaves with it — but only when empty:
 *  anything else in `.agents/` belongs to the person. */
function dropDirIfEmpty(dir: string): void {
  try {
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  } catch {
    // Absent is the goal.
  }
}

/** Remove it, and any now-empty directories the drop created. */
export async function removeSkill(projectDir: string): Promise<string | null> {
  const dir = join(projectDir, ...SKILL_DIR);
  const at = join(dir, "SKILL.md");
  try {
    readFileSync(at);
  } catch {
    return null;
  }
  rmSync(at, { force: true });
  dropDirIfEmpty(dir);
  dropDirIfEmpty(join(projectDir, ".agents", "skills"));
  dropDirIfEmpty(join(projectDir, ".agents"));
  return at;
}

/** Whether the drop is present and current — stale content reads as absent,
 *  because an old skill teaching old doors is worse than none. */
export function verifySkill(projectDir: string): { present: boolean; current: boolean } {
  try {
    const held = readFileSync(join(projectDir, ...SKILL_DIR, "SKILL.md"), "utf8");
    return { present: true, current: held === SKILL };
  } catch {
    return { present: false, current: false };
  }
}

export { SKILL as SKILL_CONTENT };
