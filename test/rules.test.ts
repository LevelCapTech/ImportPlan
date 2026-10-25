import { test } from "node:test";
import assert from "node:assert/strict";

import { planImport } from "../src/index.js";

function withRule(
  rule: unknown,
  incomingValue: unknown,
  existingValue: unknown,
) {
  return planImport({
    incoming: [{ id: 1, v: incomingValue }],
    existing: [{ id: 1, v: existingValue }],
    key: "id",
    compare: { v: rule as never },
  });
}

test("trim ignores leading/trailing whitespace but keeps originals", () => {
  const incoming = [{ id: 1, v: " 田中 " }];
  const plan = planImport({
    incoming,
    existing: [{ id: 1, v: "田中" }],
    key: "id",
    compare: { v: "trim" },
  });
  assert.equal(plan.unchanged.length, 1);
  assert.equal(incoming[0]?.v, " 田中 ");
});

test("trim with a non-string value is invalid_comparable_value", () => {
  const plan = withRule("trim", 5, "5");
  assert.equal(plan.conflicts[0]?.reason, "invalid_comparable_value");
});

test("numeric treats equal decimal representations as equal", () => {
  for (const [a, b] of [
    [100, "100"],
    ["100", "100.00"],
    ["100.0", "100"],
    ["-0", "0"],
    ["1.50", "1.5"],
    ["007", "7"],
  ] as const) {
    const plan = withRule("numeric", a, b);
    assert.equal(plan.unchanged.length, 1, `${a} should equal ${b}`);
  }
});

test("numeric distinguishes genuinely different numbers", () => {
  const plan = withRule("numeric", "100.01", "100.00");
  assert.equal(plan.updates.length, 1);
});

test("numeric avoids floating point error for high-precision decimals", () => {
  const plan = withRule("numeric", "0.1", "0.10000000000000001");
  assert.equal(plan.updates.length, 1);
});

test("numeric rejects scientific notation strings and junk", () => {
  for (const bad of ["1e5", "1,000", "abc", "Infinity", "NaN", ""]) {
    const plan = withRule("numeric", bad, "100");
    assert.equal(
      plan.conflicts[0]?.reason,
      "invalid_comparable_value",
      `${bad} should be rejected`,
    );
  }
});

test("numeric expands exponential JS numbers to exact decimals", () => {
  const plan = withRule("numeric", 1e21, "1000000000000000000000");
  assert.equal(plan.unchanged.length, 1);
});

test("datetime compares instants across timezones", () => {
  const plan = withRule(
    "datetime",
    "2026-01-01T00:00:00+09:00",
    "2025-12-31T15:00:00Z",
  );
  assert.equal(plan.unchanged.length, 1);
});

test("datetime rejects ambiguous date-only strings", () => {
  const plan = withRule("datetime", "2026-01-01", "2026-01-01T00:00:00Z");
  assert.equal(plan.conflicts[0]?.reason, "invalid_comparable_value");
});

test("datetime rejects timezone-less strings", () => {
  const plan = withRule("datetime", "2026-01-01T00:00:00", "2026-01-01T00:00:00Z");
  assert.equal(plan.conflicts[0]?.reason, "invalid_comparable_value");
});

test("datetime detects invalid calendar dates", () => {
  const plan = withRule("datetime", "2026-02-30T00:00:00Z", "2026-01-01T00:00:00Z");
  assert.equal(plan.conflicts[0]?.reason, "invalid_comparable_value");
});

test("custom comparator: true means equal, false means different", () => {
  const equal = withRule(
    (a: unknown, b: unknown) => String(a).length === String(b).length,
    "ab",
    "cd",
  );
  assert.equal(equal.unchanged.length, 1);

  const different = withRule((a: unknown, b: unknown) => a === b, "a", "b");
  assert.equal(different.updates.length, 1);
});

test("custom comparator exceptions become comparison_error conflicts with the cause", () => {
  const boom = new Error("boom");
  const plan = withRule(() => {
    throw boom;
  }, "a", "b");
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0]?.reason, "comparison_error");
  assert.equal(plan.conflicts[0]?.issues[0]?.cause, boom);
});

test("custom comparator must return a boolean", () => {
  const plan = withRule(() => "yes" as never, "a", "b");
  assert.equal(plan.conflicts[0]?.reason, "comparison_error");
});

test("per-field rules only affect their field", () => {
  const plan = planImport({
    incoming: [{ id: 1, amount: "100.00", name: " x " }],
    existing: [{ id: 1, amount: "100", name: "x" }],
    key: "id",
    compare: { amount: "numeric" },
  });
  // amount equal via numeric; name differs via default strict.
  assert.equal(plan.updates.length, 1);
  assert.deepEqual(plan.updates[0]?.changes.map((c) => c.field), ["name"]);
});
