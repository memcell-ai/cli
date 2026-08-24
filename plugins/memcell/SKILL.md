---
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

**Tools** named `recall`, `remember`, `ingest`, and `report`. Use them if
they are there.

**The shell**, otherwise — same doors, same memory:

```
memcell recall "<what you are trying to do or know>"
memcell remember "<one claim, in one sentence>"
memcell report <statement-id> worked|failed
memcell ingest <file>
```

If those commands are missing, run them through `npx memcell` instead. If
they answer `not wired`, this directory has no memory yet: tell the user
once, give them `npx memcell connect`, and carry on without it.

Never invent a memory tool, and never keep memory in a file of your own.

## recall — before you implement

Ask with the task in your own words: an intent or a question, not keywords.

```
memcell recall "how should retries behave when the payment gateway times out?"
memcell recall "is this ORM's transaction API still the current one?"
```

Do this at the start of a task, not after writing code — and again before
writing against a library API you are recalling from training rather than
reading. Each answer carries a confidence figure and the id you need to
report on it.

**Reading a result:**

- **0.7 and above** — the project's current position. Follow it, or state
  plainly why you are departing from it.
- **below 0.7** — a lead. Weigh it against what you find in the code.
- **`dead_end`** — an approach already tried and failed here. Do not retry
  it silently. If you believe it no longer applies, say so first, then go
  through it deliberately.
- **`layer: public`** — from the open-source commons, kept current. Where it
  contradicts what you remember about a library, it is the later source.
- **`pinned`** — a standing rule, present whatever you asked. It did not
  answer your question; do not read its presence as relevance.
- **`diverged`** — you already went against this one earlier in this
  session. It is served again for that reason. Re-read it before continuing,
  and if you believe it no longer applies, say so plainly instead of working
  around it a second time.

Nothing served means nothing is established here yet. That is an answer:
proceed, and file what you learn.

## remember — when something is established

One claim, one sentence, when work settles something durable that a
transcript would bury.

```
memcell remember "Retries cap at five attempts; after that the job parks in the dead-letter table."
memcell remember "Polling the gateway for capture status times out under load." --kind gotcha
```

File decisions, constraints discovered, and approaches that failed. Do not
file activity ("fixed the retry bug"), restatements of code, or anything
`git log` already carries.

A **rule** — something a future session could disobey — takes `--at`, naming
the moments it bears on, so it is served again at the one it applies to
rather than only at the start of a session:

```
memcell remember "Never push straight to main." --at send
memcell remember "Run the formatter before committing." --at record
memcell remember "Work on a copy; the original is the reference." --at change
```

`read` looked something up, nothing changed · `change` something of yours
changed and you can still undo it · `record` it is durable and your own side
will act on it · `send` it left and cannot be taken back · `answer` the
person you are working for has your words. Several are fine. Leave `--at`
off for knowledge — a fact cannot be disobeyed.

## report — what makes the figures real

When something memory served turns out to have worked or failed, say so
against its id:

```
memcell report 941435d1-36da-4611-9a41-8e410d2af25a worked
memcell report 941435d1-36da-4611-9a41-8e410d2af25a failed --note "the cap did not hold under load"
```

This is the only thing that moves confidence, and it is what separates this
from a notes file. A recall nobody reports on teaches the record nothing,
and stale confidence is worse than none.

Report `failed` when you followed a statement and the work went wrong, or
when it turned out untrue. Going against a statement that still stands is a
different thing: it is recorded on its own, moves no confidence, and brings
the statement back on your next recall. Say so in the conversation either
way, rather than silently overriding it.

## ingest — when a document carries decisions

Hand specs, ADRs, and runbooks over whole:

```
memcell ingest docs/adr/012-retry-policy.md
```

Do not summarize the document yourself — it is distilled into individual
claims, each keeping provenance back to what it came from.

## While you work

In a wired project, hooks already recall at session start and capture the
turn's material at the end, so routine work needs no filing from you. The
calls above are what you reach for mid-turn: recall before deciding, report
when an outcome lands.
