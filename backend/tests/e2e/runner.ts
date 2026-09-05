/**
 * A ~150-line test runner, because this suite's hard parts are not the ones a framework
 * solves. It needs a global rate-limit bucket, socket-event collection with timeouts, and
 * strictly ordered steps through a state machine — none of which come out of a box. What is
 * left is registration, assertions and a report, which is this file.
 *
 * The one non-obvious feature is `test.known()`. Several cases in the catalogue are written
 * against defects that are known to exist right now. Reporting those as plain failures buries
 * the real signal — a genuinely new break — under noise. A known case that fails is reported
 * as CONFIRMED (the defect is still there, as expected); the same case passing is reported as
 * FIXED and is what the Phase 3 loop is driving toward.
 */

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

type TestFn = () => Promise<void>;
type Case = { id: string; name: string; fn: TestFn; known?: string };
type Suite = { key: string; name: string; cases: Case[] };

const suites: Suite[] = [];
let current: Suite | null = null;

export function suite(key: string, name: string, body: () => void): void {
  current = { key, name, cases: [] };
  suites.push(current);
  body();
  current = null;
}

export function test(id: string, name: string, fn: TestFn): void {
  if (!current) throw new Error(`test("${id}") declared outside a suite()`);
  current.cases.push({ id, name, fn });
}

/**
 * A case written against a defect we already know about. `reason` names the fix it is
 * waiting on, so a CONFIRMED line in the report points straight at the work.
 */
test.known = function known(id: string, name: string, reason: string, fn: TestFn): void {
  if (!current) throw new Error(`test.known("${id}") declared outside a suite()`);
  current.cases.push({ id, name, fn, known: reason });
};

// ---------------------------------------------------------------------------- assertions

function show(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try {
    const s = JSON.stringify(v);
    return s && s.length > 400 ? `${s.slice(0, 400)}…` : String(s);
  } catch {
    return String(v);
  }
}

export function expect(actual: unknown, label = "value") {
  return {
    toBe(want: unknown) {
      if (actual !== want) throw new AssertionError(`${label}: expected ${show(want)}, got ${show(actual)}`);
    },
    toEqual(want: unknown) {
      if (JSON.stringify(actual) !== JSON.stringify(want))
        throw new AssertionError(`${label}: expected ${show(want)}, got ${show(actual)}`);
    },
    toBeOneOf(want: readonly unknown[]) {
      if (!want.includes(actual))
        throw new AssertionError(`${label}: expected one of ${show(want)}, got ${show(actual)}`);
    },
    toContain(want: unknown) {
      const ok =
        typeof actual === "string"
          ? actual.includes(String(want))
          : Array.isArray(actual) && actual.includes(want);
      if (!ok) throw new AssertionError(`${label}: expected ${show(actual)} to contain ${show(want)}`);
    },
    toBeCloseTo(want: number, tolerance: number) {
      const n = Number(actual);
      if (!Number.isFinite(n) || Math.abs(n - want) > tolerance)
        throw new AssertionError(`${label}: expected ${want} ±${tolerance}, got ${show(actual)}`);
    },
    toBeDefined() {
      if (actual === undefined || actual === null)
        throw new AssertionError(`${label}: expected a value, got ${show(actual)}`);
    },
    toBeUndefined() {
      if (actual !== undefined) throw new AssertionError(`${label}: expected undefined, got ${show(actual)}`);
    },
    toBeNull() {
      if (actual !== null) throw new AssertionError(`${label}: expected null, got ${show(actual)}`);
    },
    toBeTruthy() {
      if (!actual) throw new AssertionError(`${label}: expected truthy, got ${show(actual)}`);
    },
    toBeFalsy() {
      if (actual) throw new AssertionError(`${label}: expected falsy, got ${show(actual)}`);
    },
    toBeGreaterThan(want: number) {
      if (!(Number(actual) > want))
        throw new AssertionError(`${label}: expected > ${want}, got ${show(actual)}`);
    },
    toBeLessThan(want: number) {
      if (!(Number(actual) < want))
        throw new AssertionError(`${label}: expected < ${want}, got ${show(actual)}`);
    },
  };
}

export function fail(message: string): never {
  throw new AssertionError(message);
}

// ------------------------------------------------------------------------------- running

export type Outcome = "pass" | "fail" | "confirmed" | "fixed";

export type Result = {
  suite: string;
  id: string;
  name: string;
  outcome: Outcome;
  error?: string;
  reason?: string;
  ms: number;
};

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const OFF = "\x1b[0m";

const MARK: Record<Outcome, string> = {
  pass: `${GREEN}✓${OFF}`,
  fail: `${RED}✗${OFF}`,
  confirmed: `${YELLOW}![${OFF}`,
  fixed: `${CYAN}★${OFF}`,
};

/**
 * No single case may hang the run.
 *
 * Generous, because the dispatch suite genuinely waits out a 60s sweep against a 90s
 * threshold. But bounded: one stalled request used to take every case after it down with it,
 * since by the time it resumed every fixture token had expired and the rest of the run
 * reported 401s that had nothing to do with the code under test.
 */
const CASE_TIMEOUT_MS = 300_000;

function withTimeout(fn: TestFn, name: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`case "${name}" exceeded ${CASE_TIMEOUT_MS / 1000}s and was abandoned`)),
      CASE_TIMEOUT_MS,
    );
    fn().then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export async function runSuites(only?: string[]): Promise<Result[]> {
  const results: Result[] = [];
  const selected = only?.length ? suites.filter((s) => only.includes(s.key)) : suites;

  if (only?.length) {
    const unknown = only.filter((k) => !suites.some((s) => s.key === k));
    if (unknown.length) throw new Error(`Unknown suite(s): ${unknown.join(", ")}`);
  }

  for (const s of selected) {
    console.log(`\n${DIM}────${OFF} ${s.name} ${DIM}(${s.cases.length} cases)${OFF}`);
    for (const c of s.cases) {
      const started = Date.now();
      let outcome: Outcome;
      let error: string | undefined;
      try {
        await withTimeout(c.fn, `${c.id} ${c.name}`);
        outcome = c.known ? "fixed" : "pass";
      } catch (e) {
        error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        outcome = c.known ? "confirmed" : "fail";
      }
      const ms = Date.now() - started;
      results.push({ suite: s.name, id: c.id, name: c.name, outcome, error, reason: c.known, ms });

      const timing = ms > 2000 ? ` ${DIM}${(ms / 1000).toFixed(1)}s${OFF}` : "";
      console.log(`  ${MARK[outcome]} ${DIM}${c.id}${OFF} ${c.name}${timing}`);
      if (outcome === "fail") console.log(`      ${RED}${error}${OFF}`);
      if (outcome === "confirmed") console.log(`      ${YELLOW}known: ${c.known}${OFF}`);
      if (outcome === "fixed") console.log(`      ${CYAN}now passing — was: ${c.known}${OFF}`);
    }
  }
  return results;
}

export function report(results: Result[]): number {
  const by = (o: Outcome) => results.filter((r) => r.outcome === o);
  const passed = by("pass");
  const failed = by("fail");
  const confirmed = by("confirmed");
  const fixed = by("fixed");

  console.log(`\n${DIM}${"═".repeat(72)}${OFF}`);
  console.log(
    `  ${results.length} cases   ` +
      `${GREEN}${passed.length} passed${OFF}   ` +
      `${RED}${failed.length} failed${OFF}   ` +
      `${YELLOW}${confirmed.length} known-defect confirmed${OFF}   ` +
      `${CYAN}${fixed.length} newly fixed${OFF}`,
  );

  if (failed.length) {
    console.log(`\n${RED}Failures — these are real and unexpected:${OFF}`);
    for (const r of failed) console.log(`  ${r.id} ${r.name}\n      ${r.error}`);
  }
  if (confirmed.length) {
    console.log(`\n${YELLOW}Known defects still present:${OFF}`);
    for (const r of confirmed) console.log(`  ${r.id} ${r.name} — ${r.reason}`);
  }
  if (fixed.length) {
    console.log(`\n${CYAN}Known defects now fixed — flip these to plain test():${OFF}`);
    for (const r of fixed) console.log(`  ${r.id} ${r.name}`);
  }

  // Only an unexpected failure breaks the build. A confirmed known defect is information the
  // run is meant to produce, not a reason to exit non-zero every time until it is fixed.
  return failed.length > 0 ? 1 : 0;
}
