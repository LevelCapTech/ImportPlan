# ImportPlan

> Generate safe, deterministic data‑import plans by diffing two record arrays.

`@levelcap/import-plan` compares the data you are about to import (`incoming`)
against the data you already have (`existing`), matches records by a key, and
classifies every incoming record into **creates**, **updates**, **unchanged** or
**conflicts** — plus summary `stats`. It is the complex matching / diffing /
conflict‑detection logic that applications re‑implement by hand, packaged as a
single pure function.

```ts
import { planImport } from "@levelcap/import-plan";

const plan = planImport({
  incoming: csvData,
  existing: dbData,
  key: "id",
});

console.log(plan.creates);
console.log(plan.updates);
console.log(plan.unchanged);
console.log(plan.conflicts);
```

## Why

- **Drop‑in.** One synchronous function. No classes, no setup, no config files,
  no CLI, no server, no database connection. It plugs into the data you already
  fetched.
- **No side effects.** It never mutates inputs, never writes to a database or
  file, never performs network I/O, and never touches global state or the system
  clock.
- **Deterministic.** The same input and options always produce the same result.
  It never silently picks a winner among duplicates, auto‑corrects ambiguous
  data, or coerces types.
- **Safe with conflicts.** Records it cannot classify unambiguously are routed to
  `conflicts` with machine‑readable reason codes — never mixed into `creates` or
  `updates`.
- **Type‑safe.** Written in TypeScript with full inference; you rarely need to
  specify a generic. Runtime validation protects JavaScript callers too.
- **Scales.** Near‑linear matching via nested `Map`s; no whole‑record JSON
  stringification, no unnecessary deep copies.
- **Lightweight.** A single package, **zero runtime dependencies**, shipped as
  both ESM and CommonJS.

## Install

```sh
npm install @levelcap/import-plan
```

Requires Node.js 18+ (works in the browser too). Ships ESM and CommonJS builds
with bundled type declarations.

```ts
// ESM
import { planImport } from "@levelcap/import-plan";
// CommonJS
const { planImport } = require("@levelcap/import-plan");
```

## Quick start

Given the current data:

```json
[
  { "id": 1, "name": "田中" },
  { "id": 2, "name": "佐藤" },
  { "id": 3, "name": "鈴木" }
]
```

and the incoming data:

```json
[
  { "id": 1, "name": "田中" },
  { "id": 2, "name": "佐藤太郎" },
  { "id": 4, "name": "山田" },
  { "id": 4, "name": "山田" }
]
```

```ts
const plan = planImport({ incoming, existing, key: "id" });

plan.creates.length;   // 0  — id:4 is a new record but it is duplicated, so it conflicts
plan.updates.length;   // 1  — id:2 name changed
plan.unchanged.length; // 1  — id:1 is identical
plan.conflicts.length; // 1  — id:4 appears twice in incoming
```

- **id:1** → `unchanged` (values are identical)
- **id:2** → `updates` (`name` changed)
- **id:3** → ignored (not present in `incoming`; never a delete candidate)
- **id:4** → `conflicts` with reason `duplicate_incoming_key`; both rows are
  withheld from `creates`.

## API

```ts
function planImport<TIncoming, TExisting>(
  options: ImportPlanOptions<TIncoming, TExisting>,
): ImportPlanResult<TIncoming, TExisting>;
```

`planImport` is synchronous — it returns a plain object, not a `Promise`, and
requires no `await` and no instance.

### Options

| Property         | Required | Description                                                        |
| ---------------- | -------- | ------------------------------------------------------------------ |
| `incoming`       | yes      | Array of records being imported. Never mutated.                    |
| `existing`       | yes      | Array (snapshot) of records that already exist. Never mutated.     |
| `key`            | yes      | A single field name, or a tuple of field names (composite key).    |
| `protectedFields`| no       | Field names that must never change on an update.                   |
| `ignoreFields`   | no       | Field names excluded from change detection and from the `patch`.   |
| `compare`        | no       | Per‑field comparison rule overrides (see [Comparison](#comparison)).|

All options other than `incoming`, `existing` and `key` are optional, and the
defaults are safe. `readonly` arrays are accepted.

## Key matching

### Single and composite keys

```ts
key: "id"                            // single field
key: ["companyId", "customerId"]     // composite key
```

Records match only when **all** key fields are equal. Different `companyId`
values are treated as different records even if `customerId` matches.

### Strict, no coercion

Keys are compared without any implicit conversion, so the following are all
**different** keys:

```ts
1        !== "1"
"ABC"    !== "abc"
"田中"   !== " 田中 "
```

### Valid key scalars

A key component must be one of:

- a non‑blank `string`,
- a finite `number` (`0` and `-0` are treated as the same key), or
- a `boolean` (`false` is a valid key).

The following are **invalid** as key components: `null`, `undefined`, `NaN`,
`Infinity`, empty or whitespace‑only strings, objects, arrays, functions,
`Symbol`, `bigint`, and a missing key property. An invalid key on an *incoming*
record produces an `invalid_key` conflict; an invalid key on an *existing* record
throws an [`ImportPlanInputError`](#error-handling) (the existing snapshot must be
sound before any plan can be trusted).

### Collision‑free composite keys

Composite keys are **not** produced by naïvely concatenating stringified parts,
so these remain distinct:

```ts
["a:b", "c"]   // not equal to
["a", "b:c"]
```

Matching uses a type‑tagged, length‑prefixed encoding that preserves component
boundaries and value types, so `1` never collides with `"1"` and `0` never
collides with `false`.

### Key shape in results

For a single‑field key, `entry.key` is the raw scalar (e.g. `1`). For a composite
key it is an object mapping each field to its value
(e.g. `{ companyId: 1, customerId: 100 }`).

## Comparison

By default only the incoming record's **own enumerable properties** are compared,
so partial updates are safe: a field that is absent from `incoming` is never
treated as a change, and a field present only on the existing record is never
treated as a deletion. Key fields are excluded from change detection.

The default (`strict`) comparison is structural and type‑aware:

- no implicit coercion — `1 !== "1"`, `null !== undefined`, `"" !== null`,
  `false !== 0`;
- object property order is ignored; array element order is significant;
- arrays and plain objects are different types;
- nested plain objects and arrays are compared recursively by value (different
  references with the same structure are equal);
- valid `Date` instances are compared by their UTC instant.

Changes are reported per top‑level field; ImportPlan does not deep‑merge nested
objects.

### Per‑field rules

Use `compare` to override the rule for individual fields:

```ts
const plan = planImport({
  incoming,
  existing,
  key: "id",
  compare: {
    name: "trim",
    amount: "numeric",
    updatedAt: "datetime",
    code: (incomingValue, existingValue) => incomingValue === existingValue,
  },
});
```

| Rule        | Behaviour                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------- |
| `strict`    | Default. Structural, type‑aware deep equality (described above).                          |
| `trim`      | Compares strings ignoring leading/trailing whitespace. Non‑strings are not coerced.       |
| `numeric`   | Compares exact decimal representations, so `100`, `"100"` and `"100.00"` are equal.       |
| `datetime`  | Compares RFC 3339 timestamps / `Date` instances as instants, timezone‑aware.              |
| function    | Your own synchronous comparator; `true` = equal, `false` = different.                     |

**`numeric`** uses exact decimal comparison (not `Number()`), so it is safe for
money and large values: differing decimal places compare correctly, trailing
zeros are normalized, and floating‑point error is avoided. It accepts a finite
`number` or a plain decimal string. Scientific notation strings, grouping
separators, `Infinity` and `NaN` are rejected as `invalid_comparable_value`.
(See the [number precision caveat](#caveats).)

**`datetime`** requires a valid `Date`, or an RFC 3339 date‑time string **with a
timezone**. Date‑only strings (`"2026-01-01"`), timezone‑less strings and
impossible calendar dates (e.g. `"2026-02-30T..."`) are rejected as
`invalid_comparable_value` rather than silently reinterpreted.

**Custom comparators** must be synchronous and should be pure (ImportPlan never
re‑invokes them). A thrown error is reported as a `comparison_error` conflict
with the original error preserved on `issue.cause`; returning a non‑boolean is
also a `comparison_error`. Errors are never swallowed.

A rule is only applied when the field is present on both records; a value that a
rule cannot handle produces a conflict for that record instead of a forced
comparison.

## Protected fields

```ts
protectedFields: ["createdAt", "companyId"]
```

If a protected field would change, the whole record is withheld from `updates`
and reported as a `protected_field_changed` conflict (one issue per violated
field). A protected field that is absent from `incoming`, or whose value is
unchanged, is not a violation. Protected fields may still be set freely on
`creates`. Only top‑level fields are supported.

## Ignored fields

```ts
ignoreFields: ["importTimestamp", "lastCheckedAt"]
```

Ignored fields are excluded from change detection and never appear in a `patch`,
even when their existing value differs. Key fields are always used for matching
regardless. Input data is never modified, so the original values remain available
on the referenced records for your create/update logic.

`protectedFields` and `ignoreFields` must not overlap; doing so is a
configuration error.

## Result

```ts
interface ImportPlanResult<TIncoming, TExisting> {
  creates: CreateEntry<TIncoming>[];
  updates: UpdateEntry<TIncoming, TExisting>[];
  unchanged: UnchangedEntry<TIncoming, TExisting>[];
  conflicts: ConflictEntry<TIncoming, TExisting>[];
  stats: ImportStats;
}
```

### `creates`

```ts
{ key, incoming, incomingIndex }
```

### `updates`

```ts
{ key, incoming, existing, incomingIndex, existingIndex, patch, changes }
```

`patch` contains **only** the changed fields and their new values (never key
fields, never ignored fields). For example:

```ts
existing = { id: 1, name: "佐藤", age: 30 };
incoming = { id: 1, name: "佐藤太郎", age: 30 };
// patch => { name: "佐藤太郎" }
```

`changes` is an array of field‑level diffs, ordered deterministically by field
name:

```ts
{
  field: "name",
  before: "佐藤",
  after: "佐藤太郎",
  beforeExists: true,
  afterExists: true,
}
```

`beforeExists` / `afterExists` distinguish "property absent" from "property
present with value `undefined`".

### `unchanged`

```ts
{ key, incoming, existing, incomingIndex, existingIndex }
```

### `conflicts`

```ts
{
  key,                 // set only when it could be resolved
  reason,              // primary (highest-priority) ConflictReason
  issues,              // all detected problems (code, message, optional field/cause)
  candidateOperation,  // "create" | "update" | "unknown"
  incomingIndexes,     // ascending indexes into `incoming`
  existingIndexes,     // ascending indexes into `existing`
  incoming,            // the involved incoming records (by reference)
  existing,            // the involved existing records (by reference)
}
```

Records duplicated on a key are returned as a single conflict group. Branch on
`reason` / `issue.code`, never on the human‑readable `message`.

#### Conflict reason codes

| Code                       | Meaning                                              |
| -------------------------- | ---------------------------------------------------- |
| `duplicate_incoming_key`   | The same key appears more than once in `incoming`.   |
| `duplicate_existing_key`   | The same key appears more than once in `existing`.   |
| `protected_field_changed`  | A `protectedFields` value would change on update.    |
| `invalid_key`              | An incoming record's key is missing or invalid.      |
| `unsupported_value`        | A compared value is of an unsupported kind.          |
| `invalid_comparable_value` | A value does not fit the chosen `compare` rule.      |
| `comparison_error`         | A custom comparator threw or returned a non‑boolean. |
| `invalid_incoming_record`  | An incoming entry is not a valid record object.      |

`ConflictReason` is exported as a string‑literal union.

### `stats`

```ts
{
  incomingRows,            // total incoming records
  existingRows,            // total existing records
  createRows,              // records that can be created
  updateRows,              // records that can be updated
  unchangedRows,           // records with no detected change
  conflictGroups,          // number of conflict groups
  conflictedIncomingRows,  // incoming records belonging to a conflict group
  ignoredExistingRows,     // existing records with no corresponding incoming key
}
```

The following invariant always holds:

```ts
incomingRows === createRows + updateRows + unchangedRows + conflictedIncomingRows;
```

Note that `conflictGroups` counts groups, while `conflictedIncomingRows` counts
rows — three duplicate rows of one key are one group but three conflicted rows.

## Determinism and ordering

- `creates`, `updates` and `unchanged` follow `incoming` order.
- `conflicts` are ordered by each group's first incoming index.
- Indexes within a group are ascending; `changes` are ordered by field name.
- The original input arrays are never reordered or otherwise mutated.

## Safety

- **Inputs are never mutated**, including deeply nested objects.
- **Results hold references** to the original records (no wholesale deep copy)
  for performance. Only `patch` and `changes` are newly allocated. If you later
  mutate the original data, the referenced records in the result reflect that —
  treat the inputs as immutable after planning.
- **Prototype‑pollution safe.** Dangerous property names such as `__proto__`,
  `constructor` and `prototype` in the input never pollute `Object.prototype`;
  generated objects use null‑prototype storage and safe property definition.
- **Environment‑agnostic.** No dependency on the filesystem, a database client,
  `fetch`, the DOM, local storage, the network, or the system clock.

## Error handling

Problems fall into two categories:

1. **Configuration / whole‑input errors** throw `ImportPlanInputError` — for
   example `incoming`/`existing` not being arrays, an invalid or empty `key`, a
   composite key with a repeated field, an unknown `compare` rule, overlapping
   `protectedFields`/`ignoreFields`, or an existing record that is not an object
   or lacks a valid key. These fail fast, without returning a partial plan,
   because a corrupt existing snapshot could otherwise allow unsafe creates.
2. **Per‑record conflicts** are returned in `conflicts` (invalid incoming key,
   duplicates, protected‑field changes, unsupported/invalid values, custom
   comparator errors) while all other records are still planned.

```ts
import { planImport, ImportPlanInputError, isImportPlanInputError } from "@levelcap/import-plan";

try {
  planImport({ incoming, existing, key: "id" });
} catch (error) {
  if (isImportPlanInputError(error)) {
    // error.code === "IMPORT_PLAN_INPUT_ERROR"
  }
}
```

`isImportPlanInputError` works even across multiple copies/bundles of the
library. ImportPlan never uses `console.*`, never swallows errors, never repairs
data, and never silently skips a conflicting record.

## Relationship to database transactions

ImportPlan is **not** a transaction manager. It compares the two snapshots you
pass in; it does not connect to or modify any database. The underlying data may
change after a plan is produced, so obtaining `plan.updates` does not guarantee a
write will remain safe forever. When applying a plan, use your own transaction,
optimistic locking or re‑validation at write time.

## Caveats

- **`undefined` and JSON.** `undefined` is a comparable value (a present
  `undefined` differs from a stored value and from an absent property), but it is
  lost when serialized to JSON. How `undefined` is applied to a database on
  update is the caller's responsibility.
- **Number precision.** The `numeric` rule compares decimal **strings** exactly,
  but any value that is already a JavaScript `number` carries that type's inherent
  precision limits. Keep high‑precision values (money, big integers) as strings.
- **Unsupported values.** Circular references, functions, `Symbol`, `Map`, `Set`,
  `WeakMap`, `WeakSet`, `RegExp`, class instances, `NaN`/`Infinity` and accessor
  properties are not compared by value. If they appear in a compared incoming
  field the record is reported as a conflict rather than force‑stringified.

## TypeScript

Types are inferred from your data — you generally don't pass generics:

```ts
type IncomingCustomer = { id: number; name: string };
type ExistingCustomer = { id: number; name: string; createdAt: string };

const incoming: IncomingCustomer[] = [];
const existing: ExistingCustomer[] = [];

const plan = planImport({ incoming, existing, key: "id" });
// plan.creates[number].incoming is IncomingCustomer
// plan.updates[number].incoming / .existing keep their respective types
```

`key` is checked against the fields common to both record types, so a typo is a
compile‑time error. Composite keys work with `as const`:

```ts
key: ["companyId", "customerId"] as const;
```

Compile‑time checks are a convenience, not the safety boundary: ImportPlan also
validates everything at runtime for JavaScript callers.

### Exports

Value exports: `planImport`, `ImportPlanInputError`, `isImportPlanInputError`.

Type exports: `ImportPlanOptions`, `ImportPlanResult`, `CreateEntry`,
`UpdateEntry`, `UnchangedEntry`, `ConflictEntry`, `ConflictIssue`,
`ConflictReason`, `CandidateOperation`, `FieldChange`, `ImportStats`,
`CompareRule`, `CompareFunction`, `KeyInput`, `KeyScalar`, `KeyValue`,
`CommonKey`.

## License

[MIT](./LICENSE)