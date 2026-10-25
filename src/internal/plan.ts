/**
 * The core planning algorithm: match incoming and existing records by key,
 * detect duplicates and conflicts, compute field-level diffs, and classify each
 * record into creates / updates / unchanged / conflicts.
 *
 * Complexity is linear in the total number of records and compared fields: keys
 * are hashed into `Map`s rather than re-scanning arrays per record, and records
 * are never deep-copied or JSON-serialised wholesale.
 */
import type {
  CandidateOperation,
  CompareRule,
  ConflictEntry,
  ConflictIssue,
  ConflictReason,
  CreateEntry,
  FieldChange,
  ImportPlanResult,
  ImportStats,
  KeyScalar,
  KeyValue,
  UnchangedEntry,
  UpdateEntry,
} from "../types.js";
import { ImportPlanInputError } from "../errors.js";
import { compareValues } from "./compare.js";
import { resolveKey, toKeyValue } from "./keys.js";
import type { NormalizedOptions } from "./options.js";
import {
  createSafeObject,
  isRecordObject,
  ownEnumerableKeys,
  readOwnProperty,
} from "./object.js";

/**
 * Priority used to pick a conflict group's primary `reason` and to order its
 * `issues` deterministically. Lower numbers win.
 */
const REASON_PRIORITY: Record<ConflictReason, number> = {
  invalid_incoming_record: 0,
  invalid_key: 1,
  duplicate_incoming_key: 2,
  duplicate_existing_key: 3,
  unsupported_value: 4,
  invalid_comparable_value: 5,
  comparison_error: 6,
  protected_field_changed: 7,
};

interface ExistingBucket {
  readonly indexes: number[];
}

interface IncomingGroup {
  readonly indexes: number[];
  readonly components: KeyScalar[];
}

interface PendingConflict {
  readonly key?: KeyValue;
  readonly issues: ConflictIssue[];
  readonly candidateOperation: CandidateOperation;
  readonly incomingIndexes: number[];
  readonly existingIndexes: number[];
}

interface RecordDiff {
  readonly changes: FieldChange[];
  readonly issues: ConflictIssue[];
}

const ascending = (a: number, b: number): number => a - b;

export function buildPlan(
  normalized: NormalizedOptions,
): ImportPlanResult<unknown, unknown> {
  const { incoming, existing, keyFields, isComposite } = normalized;

  const existingIndex = buildExistingIndex(existing, keyFields);
  const { groups, invalidConflicts } = buildIncomingGroups(incoming, keyFields);

  const creates: CreateEntry<unknown>[] = [];
  const updates: UpdateEntry<unknown, unknown>[] = [];
  const unchanged: UnchangedEntry<unknown, unknown>[] = [];
  const pending: PendingConflict[] = [...invalidConflicts];

  for (const [encoded, group] of groups) {
    const keyValue = toKeyValue(keyFields, group.components, isComposite);
    const existingBucket = existingIndex.get(encoded);
    const duplicateIncoming = group.indexes.length > 1;
    const duplicateExisting =
      existingBucket !== undefined && existingBucket.indexes.length > 1;

    if (duplicateIncoming || duplicateExisting) {
      pending.push(
        buildDuplicateConflict(keyValue, group, existingBucket, {
          duplicateIncoming,
          duplicateExisting,
        }),
      );
      continue;
    }

    const incomingIndex = group.indexes[0] as number;
    const incomingRecord = incoming[incomingIndex];

    if (existingBucket === undefined) {
      creates.push({ key: keyValue, incoming: incomingRecord, incomingIndex });
      continue;
    }

    const existingRecordIndex = existingBucket.indexes[0] as number;
    const existingRecord = existing[existingRecordIndex];
    const diff = diffRecords(
      incomingRecord as object,
      existingRecord as object,
      normalized,
    );

    if (diff.issues.length > 0) {
      pending.push({
        key: keyValue,
        issues: diff.issues,
        candidateOperation: "update",
        incomingIndexes: [incomingIndex],
        existingIndexes: [existingRecordIndex],
      });
      continue;
    }

    if (diff.changes.length > 0) {
      updates.push({
        key: keyValue,
        incoming: incomingRecord,
        existing: existingRecord,
        incomingIndex,
        existingIndex: existingRecordIndex,
        patch: createSafeObject(diff.changes.map((change) => [change.field, change.after])),
        changes: diff.changes,
      });
      continue;
    }

    unchanged.push({
      key: keyValue,
      incoming: incomingRecord,
      existing: existingRecord,
      incomingIndex,
      existingIndex: existingRecordIndex,
    });
  }

  const conflicts = pending
    .sort((a, b) => minIndex(a.incomingIndexes) - minIndex(b.incomingIndexes))
    .map((conflict) => finalizeConflict(conflict, incoming, existing));

  const stats = buildStats(normalized, {
    creates,
    updates,
    unchanged,
    conflicts,
    groups,
    existingIndex,
  });

  return { creates, updates, unchanged, conflicts, stats };
}

function buildExistingIndex(
  existing: readonly unknown[],
  keyFields: readonly string[],
): Map<string, ExistingBucket> {
  const index = new Map<string, ExistingBucket>();
  for (let i = 0; i < existing.length; i += 1) {
    const record = existing[i];
    if (!isRecordObject(record)) {
      throw new ImportPlanInputError(
        `existing[${i}] must be a non-null object, so it can be matched by key.`,
      );
    }
    const resolved = resolveKey(record, keyFields);
    if (!resolved.ok) {
      throw new ImportPlanInputError(`existing[${i}] has an invalid key: ${resolved.reason}`);
    }
    const bucket = index.get(resolved.encoded);
    if (bucket === undefined) {
      index.set(resolved.encoded, { indexes: [i] });
    } else {
      bucket.indexes.push(i);
    }
  }
  return index;
}

function buildIncomingGroups(
  incoming: readonly unknown[],
  keyFields: readonly string[],
): { groups: Map<string, IncomingGroup>; invalidConflicts: PendingConflict[] } {
  const groups = new Map<string, IncomingGroup>();
  const invalidConflicts: PendingConflict[] = [];

  for (let i = 0; i < incoming.length; i += 1) {
    const record = incoming[i];
    if (!isRecordObject(record)) {
      invalidConflicts.push({
        issues: [
          {
            code: "invalid_incoming_record",
            message: `incoming[${i}] is not a non-null object and cannot be processed.`,
          },
        ],
        candidateOperation: "unknown",
        incomingIndexes: [i],
        existingIndexes: [],
      });
      continue;
    }

    const resolved = resolveKey(record, keyFields);
    if (!resolved.ok) {
      invalidConflicts.push({
        issues: [
          {
            code: "invalid_key",
            message: `incoming[${i}] has an invalid key: ${resolved.reason}`,
          },
        ],
        candidateOperation: "unknown",
        incomingIndexes: [i],
        existingIndexes: [],
      });
      continue;
    }

    const group = groups.get(resolved.encoded);
    if (group === undefined) {
      groups.set(resolved.encoded, { indexes: [i], components: resolved.components });
    } else {
      group.indexes.push(i);
    }
  }

  return { groups, invalidConflicts };
}

function buildDuplicateConflict(
  key: KeyValue,
  group: IncomingGroup,
  existingBucket: ExistingBucket | undefined,
  flags: { duplicateIncoming: boolean; duplicateExisting: boolean },
): PendingConflict {
  const issues: ConflictIssue[] = [];
  if (flags.duplicateIncoming) {
    issues.push({
      code: "duplicate_incoming_key",
      message: `${group.indexes.length} incoming records share this key.`,
    });
  }
  if (flags.duplicateExisting && existingBucket !== undefined) {
    issues.push({
      code: "duplicate_existing_key",
      message: `${existingBucket.indexes.length} existing records share this key.`,
    });
  }

  let candidateOperation: CandidateOperation;
  if (flags.duplicateExisting) {
    candidateOperation = "unknown";
  } else if (existingBucket !== undefined) {
    candidateOperation = "update";
  } else {
    candidateOperation = "create";
  }

  return {
    key,
    issues,
    candidateOperation,
    incomingIndexes: group.indexes.slice().sort(ascending),
    existingIndexes: existingBucket ? existingBucket.indexes.slice().sort(ascending) : [],
  };
}

function diffRecords(
  incomingRecord: object,
  existingRecord: object,
  normalized: NormalizedOptions,
): RecordDiff {
  const { keyFieldSet, ignoreFields, protectedFields, compare } = normalized;
  const changes: FieldChange[] = [];
  const issues: ConflictIssue[] = [];

  for (const field of ownEnumerableKeys(incomingRecord)) {
    if (keyFieldSet.has(field) || ignoreFields.has(field)) {
      continue;
    }

    const afterRead = readOwnProperty(incomingRecord, field);
    if (afterRead.accessor) {
      issues.push({
        code: "unsupported_value",
        field,
        message: `field "${field}" on the incoming record is an accessor property.`,
      });
      continue;
    }
    const after = afterRead.value;

    const beforeRead = readOwnProperty(existingRecord, field);
    if (beforeRead.accessor) {
      issues.push({
        code: "unsupported_value",
        field,
        message: `field "${field}" on the existing record is an accessor property.`,
      });
      continue;
    }
    const beforeExists = beforeRead.exists;
    const before = beforeExists ? beforeRead.value : undefined;

    const outcome = beforeExists
      ? compareValues(effectiveRule(compare, field), after, before)
      : ({ kind: "changed" } as const);

    if (outcome.kind === "issue") {
      issues.push({
        code: outcome.code,
        field,
        message: outcome.message,
        ...(outcome.cause !== undefined ? { cause: outcome.cause } : {}),
      });
      continue;
    }
    if (outcome.kind === "equal") {
      continue;
    }

    if (protectedFields.has(field)) {
      issues.push({
        code: "protected_field_changed",
        field,
        message: `protected field "${field}" would change.`,
      });
    } else {
      changes.push({ field, before, after, beforeExists, afterExists: true });
    }
  }

  changes.sort(byField);
  return { changes, issues };
}

function effectiveRule(compare: Map<string, CompareRule>, field: string): CompareRule {
  return compare.get(field) ?? "strict";
}

function finalizeConflict(
  conflict: PendingConflict,
  incoming: readonly unknown[],
  existing: readonly unknown[],
): ConflictEntry<unknown, unknown> {
  const issues = conflict.issues.slice().sort(compareIssues);
  let reason = issues[0]?.code ?? "invalid_incoming_record";
  for (const issue of issues) {
    if (REASON_PRIORITY[issue.code] < REASON_PRIORITY[reason]) {
      reason = issue.code;
    }
  }

  const entry: {
    key?: KeyValue;
    reason: ConflictReason;
    issues: ConflictIssue[];
    candidateOperation: CandidateOperation;
    incomingIndexes: number[];
    existingIndexes: number[];
    incoming: unknown[];
    existing: unknown[];
  } = {
    reason,
    issues,
    candidateOperation: conflict.candidateOperation,
    incomingIndexes: conflict.incomingIndexes,
    existingIndexes: conflict.existingIndexes,
    incoming: conflict.incomingIndexes.map((index) => incoming[index]),
    existing: conflict.existingIndexes.map((index) => existing[index]),
  };
  if (conflict.key !== undefined) {
    entry.key = conflict.key;
  }
  return entry;
}

function buildStats(
  normalized: NormalizedOptions,
  data: {
    creates: readonly unknown[];
    updates: readonly unknown[];
    unchanged: readonly unknown[];
    conflicts: readonly ConflictEntry<unknown, unknown>[];
    groups: Map<string, IncomingGroup>;
    existingIndex: Map<string, ExistingBucket>;
  },
): ImportStats {
  let conflictedIncomingRows = 0;
  for (const conflict of data.conflicts) {
    conflictedIncomingRows += conflict.incomingIndexes.length;
  }

  let ignoredExistingRows = 0;
  for (const [encoded, bucket] of data.existingIndex) {
    if (!data.groups.has(encoded)) {
      ignoredExistingRows += bucket.indexes.length;
    }
  }

  return {
    incomingRows: normalized.incoming.length,
    existingRows: normalized.existing.length,
    createRows: data.creates.length,
    updateRows: data.updates.length,
    unchangedRows: data.unchanged.length,
    conflictGroups: data.conflicts.length,
    conflictedIncomingRows,
    ignoredExistingRows,
  };
}

function encodeComponents(components: readonly KeyScalar[]): string {
  // The incoming group and existing bucket share the same encoding, so we reuse
  // the already-resolved existing map by re-encoding the group's components.
  let encoded = "";
  for (const component of components) {
    if (typeof component === "string") {
      encoded += `s${component.length}:${component}`;
    } else if (typeof component === "number") {
      const text = Object.is(component, -0) ? "0" : String(component);
      encoded += `n${text.length}:${text}`;
    } else {
      encoded += component ? "b:1" : "b:0";
    }
  }
  return encoded;
}

function minIndex(indexes: readonly number[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const index of indexes) {
    if (index < min) {
      min = index;
    }
  }
  return min;
}

function byField(a: FieldChange, b: FieldChange): number {
  if (a.field < b.field) {
    return -1;
  }
  if (a.field > b.field) {
    return 1;
  }
  return 0;
}

function compareIssues(a: ConflictIssue, b: ConflictIssue): number {
  const fieldA = a.field ?? "";
  const fieldB = b.field ?? "";
  if (fieldA < fieldB) {
    return -1;
  }
  if (fieldA > fieldB) {
    return 1;
  }
  return REASON_PRIORITY[a.code] - REASON_PRIORITY[b.code];
}
