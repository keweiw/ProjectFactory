/**
 * Minimal test harness. No npm.
 *
 * Test files call `test(...)` at module scope to register; `runAll()` executes
 * everything registered so far. Two entry points share this: `tests/run.ts` for
 * node, `tests/index.html` for the browser.
 */

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

interface RegisteredTest {
  name: string;
  fn: () => void | Promise<void>;
}

const registry: RegisteredTest[] = [];

export function test(name: string, fn: () => void | Promise<void>): void {
  registry.push({ name, fn });
}

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof Set) return `Set(${show([...value])})`;
  if (value instanceof Map) return `Map(${show([...value])})`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function assert(condition: boolean, message: string): void {
  if (!condition) throw new AssertionError(message);
}

/** Deep structural equality. Enough for plain data; no cycles, no class instances. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

export function assertEqual(actual: unknown, expected: unknown, message = ""): void {
  if (!deepEqual(actual, expected)) {
    throw new AssertionError(
      `${message ? message + ": " : ""}expected ${show(expected)}, got ${show(actual)}`,
    );
  }
}

/** Floating point comparison to `places` decimal places. */
export function assertClose(
  actual: number,
  expected: number,
  places = 4,
  message = "",
): void {
  const tolerance = 0.5 * Math.pow(10, -places);
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new AssertionError(
      `${message ? message + ": " : ""}expected ${expected} +/- ${tolerance}, got ${actual}`,
    );
  }
}

export function assertThrows(fn: () => unknown, expectedName: string, message = ""): void {
  let thrown: unknown;
  let didThrow = false;
  try {
    fn();
  } catch (e) {
    didThrow = true;
    thrown = e;
  }
  if (!didThrow) {
    throw new AssertionError(`${message ? message + ": " : ""}expected ${expectedName}, nothing thrown`);
  }
  const name = thrown instanceof Error ? thrown.name : typeof thrown;
  if (name !== expectedName) {
    throw new AssertionError(
      `${message ? message + ": " : ""}expected ${expectedName}, got ${name}: ${String(thrown)}`,
    );
  }
}

export async function runAll(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  for (const t of registry) {
    try {
      await t.fn();
      results.push({ name: t.name, passed: true });
    } catch (e) {
      results.push({
        name: t.name,
        passed: false,
        error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      });
    }
  }
  return results;
}

export function summarise(results: TestResult[]): { passed: number; failed: number } {
  const failed = results.filter((r) => !r.passed).length;
  return { passed: results.length - failed, failed };
}
