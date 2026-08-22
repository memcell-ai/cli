import { mkdtempSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// The reader says a failed read out loud, and the hook log lives under the
// machine's home. A test must never write into the real one — that is how a
// suite once removed a person's live wiring — so the home is a temp dir for
// the length of this file.
const home = mkdtempSync(join(tmpdir(), "memcell-capture-home-"));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));

const { readJsonlSlice } = await import("../src/adapters/capture.js");
type OpenSlice = import("../src/adapters/capture.js").OpenSlice;

// The transcript reader, which used to read the whole record into one
// string and slice it. A long session passes Node's maximum string length,
// the read throws, the failure was swallowed as "" — and the hand-over
// reported "nothing new" while the offset never advanced. Three days of
// real work went uncaptured that way, so these pin the offset arithmetic
// the streaming read replaced it with.

const write = (lines: unknown[]): string => {
  const at = join(mkdtempSync(join(tmpdir(), "memcell-slice-")), "transcript.jsonl");
  writeFileSync(at, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return at;
};

describe("reading a transcript from an offset", () => {
  it("returns only what is new, and an offset that lands on the next line", async () => {
    const at = write([{ n: 1 }, { n: 2 }]);
    const first: unknown[] = [];
    const after = await readJsonlSlice(at, 0, (e) => first.push(e));
    expect(first).toEqual([{ n: 1 }, { n: 2 }]);

    appendFileSync(at, JSON.stringify({ n: 3 }) + "\n");
    const second: unknown[] = [];
    const end = await readJsonlSlice(at, after, (e) => second.push(e));
    // Only the delta — not the whole record again.
    expect(second).toEqual([{ n: 3 }]);
    expect(end).toBeGreaterThan(after);
  });

  it("counts bytes, not characters, so multi-byte content cannot drift the offset", async () => {
    // One emoji is four bytes and one line of prose in three scripts is
    // many; an offset counted in characters walks into the middle of a
    // line and every read after it is garbage.
    const at = write([{ say: "réédité 🌍 памятка 記録" }, { say: "second" }]);
    const seen: unknown[] = [];
    const after = await readJsonlSlice(at, 0, (e) => seen.push(e));
    expect(seen).toHaveLength(2);
    appendFileSync(at, JSON.stringify({ say: "third" }) + "\n");
    const next: unknown[] = [];
    await readJsonlSlice(at, after, (e) => next.push(e));
    expect(next).toEqual([{ say: "third" }]);
  });

  it("a record that shrank is read from the start, not seeked past its end", async () => {
    const at = write([{ n: 1 }, { n: 2 }, { n: 3 }]);
    const far = 10_000; // an offset from a longer, replaced transcript
    const seen: unknown[] = [];
    await readJsonlSlice(at, far, (e) => seen.push(e));
    expect(seen).toHaveLength(3);
  });

  it("an unreadable record is silence that does NOT move the offset", async () => {
    const seen: unknown[] = [];
    const back = await readJsonlSlice("/nowhere/at/all.jsonl", 4096, (e) => seen.push(e));
    expect(seen).toEqual([]);
    // Moving it would skip material the moment the record came back.
    expect(back).toBe(4096);
  });
});

// The second way this reader took the capture down, on 2026-08-20. The
// streaming fix above stopped the crash and then, on a stream error, reset
// the offset to where the slice began — while the lines already handed to
// `onEntry` stayed with the caller. So the adapter returned material with
// an offset that had not moved. The turn's name is the session plus that
// offset, so the next turn was named identically to this one, stood itself
// down against its own predecessor's claim, and the session never captured
// again. Two days of sessions went unrecorded with a hook log that looked
// busy the whole time.
//
// The invariant that forbids it: MATERIAL AND THE OFFSET MOVE TOGETHER, or
// neither moves. A reader may return nothing and stay put; it may return
// something and advance. It may never return something and stay put.
/** A slice that hands over real lines and THEN fails — the only shape that
 *  reaches the reader's catch with material already delivered. */
const breaksAfter = (lines: number): OpenSlice => {
  return (path, start) => {
    const kept =
      readFileSync(path, "utf8").slice(start).split("\n").slice(0, lines).join("\n") + "\n";
    let handed = false;
    return new Readable({
      read() {
        if (handed) return;
        handed = true;
        this.push(kept);
        // Fail without ending, the way a record that goes away mid-read
        // does. Signalled after the push settles: destroying inside _read
        // itself reads to Node as a throw from the read, not as the stream
        // failing, and surfaces as an uncaught exception.
        process.nextTick(() => this.destroy(new Error("EIO: the record went away")));
      },
    });
  };
};

describe("material and the offset move together", () => {
  // The "did not move" half is pinned above by the missing record, which
  // returns its offset untouched and delivers nothing.
  it("anything delivered is covered by the offset it returns", async () => {
    const at = write([{ n: 1 }, { n: 2 }, { n: 3 }]);
    const got: unknown[] = [];
    const after = await readJsonlSlice(at, 0, (e) => got.push(e));
    // The guard that would have caught the defect: entries without an
    // advance is the shape that wedges a session forever.
    expect(got.length > 0 && after === 0).toBe(false);
    expect(after).toBeGreaterThan(0);

    // And resuming there delivers each later line exactly once — the
    // property the offset exists for.
    appendFileSync(at, JSON.stringify({ n: 4 }) + "\n");
    const next: unknown[] = [];
    await readJsonlSlice(at, after, (e) => next.push(e));
    expect(next).toEqual([{ n: 4 }]);
  });

  it("a read that FAILS partway keeps the offset over what it delivered", async () => {
    const at = write([{ n: 1 }, { n: 2 }, { n: 3 }]);
    const got: unknown[] = [];
    const after = await readJsonlSlice(at, 0, (e) => got.push(e), breaksAfter(2));

    // Two lines reached the caller, so the caller has built material from
    // them and will hand it over.
    expect(got).toEqual([{ n: 1 }, { n: 2 }]);
    // Therefore the offset MUST cover them. Resetting it here is what named
    // every later turn identically to this one, stood each of them down
    // against its own predecessor's claim, and wedged the session.
    expect(after).toBeGreaterThan(0);

    // And the resume is exact: the third line once, nothing repeated.
    const next: unknown[] = [];
    await readJsonlSlice(at, after, (e) => next.push(e));
    expect(next).toEqual([{ n: 3 }]);
  });

  it("a line the reader cannot parse does not decouple them", async () => {
    const at = join(mkdtempSync(join(tmpdir(), "memcell-half-")), "transcript.jsonl");
    writeFileSync(at, `${JSON.stringify({ n: 1 })}\n{"half-written`);
    const got: unknown[] = [];
    const after = await readJsonlSlice(at, 0, (e) => got.push(e));
    expect(got).toEqual([{ n: 1 }]);
    // The half-written tail is counted, so the next read does not hand the
    // completed line over a second time.
    expect(after).toBeGreaterThan(0);
  });
});
