/**
 * Public type definitions for `@levelcap/import-plan`.
 *
 * @packageDocumentation
 */

/**
 * A primitive that may be used as (part of) a matching key.
 *
 * Only finite numbers, booleans and non-blank strings are accepted at runtime.
 */
export type KeyScalar = string | number | boolean;

/**
 * The resolved value of a record's matching key.
 *
 * For a single-field key this is the raw scalar value (for example `1`).
 * For a composite key this is an object mapping each key field to its scalar
 * value (for example `{ companyId: 1, customerId: 100 }`).
 */
export type KeyValue = KeyScalar | { readonly [field: string]: KeyScalar };

/**
 * A user supplied comparison function for a single field.
 *
 * It MUST be synchronous and SHOULD be pure. Returning `true` means the two
 * values are considered equal; `false` means they differ. Any thrown error is
 * reported as a {@link ConflictEntry} with reason `comparison_error` rather than
 * being swallowed.
 */
export type CompareFunction = (
  incomingValue: unknown,
  existingValue: unknown,
) => boolean;

/**
 * Built-in comparison strategies, or a custom {@link CompareFunction}.
 *
 * - `strict` (default): structural, type-aware deep equality.
 * - `trim`: compares strings ignoring leading/trailing whitespace.
 * - `numeric`: compares exact decimal numeric representations.
 * - `datetime`: compares RFC 3339 timestamps / `Date` instances as instants.
 */
export type CompareRule = "strict" | "trim" | "numeric" | "datetime" | CompareFunction;

/** Field name(s) that together identify a record. */
export type KeyInput<TIncoming, TExisting> =
  | CommonKey<TIncoming, TExisting>
  | readonly CommonKey<TIncoming, TExisting>[];

/** String keys that exist on both the incoming and existing record types. */
export type CommonKey<TIncoming, TExisting> = Extract<
  keyof TIncoming & keyof TExisting,
  string
>;

/** Options accepted by {@link planImport}. All fields but the first three are optional. */
export interface ImportPlanOptions<
  TIncoming extends object = Record<string, unknown>,
  TExisting extends object = Record<string, unknown>,
> {
  /** Records being imported. Never mutated. */
  readonly incoming: readonly TIncoming[];
  /** Snapshot of records that already exist. Never mutated. */
  readonly existing: readonly TExisting[];
  /** Single field name, or a tuple of field names forming a composite key. */
  readonly key: KeyInput<TIncoming, TExisting>;
  /** Fields that must never change on an update; a change routes the record to `conflicts`. */
  readonly protectedFields?: readonly string[];
  /** Fields excluded from change detection and from the generated `patch`. */
  readonly ignoreFields?: readonly string[];
  /** Per-field comparison overrides. */
  readonly compare?: Readonly<Record<string, CompareRule>>;
}

/** A record that can be safely created. */
export interface CreateEntry<TIncoming> {
  /** The matching key value. */
  readonly key: KeyValue;
  /** The original incoming record (held by reference). */
  readonly incoming: TIncoming;
  /** Index of the record within the `incoming` array. */
  readonly incomingIndex: number;
}

/** A single detected field-level difference. */
export interface FieldChange {
  /** The field name that changed. */
  readonly field: string;
  /** The previous value (from the existing record), or `undefined` when absent. */
  readonly before: unknown;
  /** The new value (from the incoming record), or `undefined` when absent. */
  readonly after: unknown;
  /** Whether the field existed as an own property on the existing record. */
  readonly beforeExists: boolean;
  /** Whether the field existed as an own property on the incoming record. */
  readonly afterExists: boolean;
}

/** A record that can be safely updated. */
export interface UpdateEntry<TIncoming, TExisting> {
  /** The matching key value. */
  readonly key: KeyValue;
  /** The original incoming record (held by reference). */
  readonly incoming: TIncoming;
  /** The matched existing record (held by reference). */
  readonly existing: TExisting;
  /** Index of the record within the `incoming` array. */
  readonly incomingIndex: number;
  /** Index of the matched record within the `existing` array. */
  readonly existingIndex: number;
  /** Freshly built object containing only the changed fields and their new values. */
  readonly patch: Record<string, unknown>;
  /** Ordered (by field name) list of detected changes. */
  readonly changes: FieldChange[];
}

/** A record whose compared fields are all equal. */
export interface UnchangedEntry<TIncoming, TExisting> {
  /** The matching key value. */
  readonly key: KeyValue;
  /** The original incoming record (held by reference). */
  readonly incoming: TIncoming;
  /** The matched existing record (held by reference). */
  readonly existing: TExisting;
  /** Index of the record within the `incoming` array. */
  readonly incomingIndex: number;
  /** Index of the matched record within the `existing` array. */
  readonly existingIndex: number;
}

/**
 * Machine-readable conflict reason codes.
 *
 * These are exposed as a string-literal union so callers can branch on the code
 * without parsing human-readable messages.
 */
export type ConflictReason =
  | "duplicate_incoming_key"
  | "duplicate_existing_key"
  | "protected_field_changed"
  | "invalid_key"
  | "unsupported_value"
  | "invalid_comparable_value"
  | "comparison_error"
  | "invalid_incoming_record";

/** What a conflicted record would have become, had it not conflicted. */
export type CandidateOperation = "create" | "update" | "unknown";

/** A single problem contributing to a {@link ConflictEntry}. */
export interface ConflictIssue {
  /** Machine-readable conflict code. */
  readonly code: ConflictReason;
  /** Human-readable description (for logging/debugging only; do not branch on it). */
  readonly message: string;
  /** The field the issue relates to, when applicable. */
  readonly field?: string;
  /** The original thrown error for `comparison_error` issues, preserved for debugging. */
  readonly cause?: unknown;
}

/** A group of one or more records that cannot be safely processed. */
export interface ConflictEntry<TIncoming = unknown, TExisting = unknown> {
  /** The matching key value, when it could be resolved. */
  readonly key?: KeyValue;
  /** The primary (highest-priority) conflict reason for this group. */
  readonly reason: ConflictReason;
  /** All problems detected for this group. */
  readonly issues: ConflictIssue[];
  /** The operation that would have been attempted without the conflict. */
  readonly candidateOperation: CandidateOperation;
  /** Ascending indexes of the involved records within the `incoming` array. */
  readonly incomingIndexes: number[];
  /** Ascending indexes of the involved records within the `existing` array. */
  readonly existingIndexes: number[];
  /** The involved incoming records (held by reference), in `incomingIndexes` order. */
  readonly incoming: readonly TIncoming[];
  /** The involved existing records (held by reference), in `existingIndexes` order. */
  readonly existing: readonly TExisting[];
}

/** Aggregate counts describing a plan. */
export interface ImportStats {
  /** Total number of incoming records. */
  readonly incomingRows: number;
  /** Total number of existing records. */
  readonly existingRows: number;
  /** Number of records that can be created. */
  readonly createRows: number;
  /** Number of records that can be updated. */
  readonly updateRows: number;
  /** Number of records with no detected change. */
  readonly unchangedRows: number;
  /** Number of conflict groups. */
  readonly conflictGroups: number;
  /** Number of incoming records belonging to a conflict group. */
  readonly conflictedIncomingRows: number;
  /** Number of existing records with no corresponding incoming key. */
  readonly ignoredExistingRows: number;
}

/** The full result returned by {@link planImport}. */
export interface ImportPlanResult<TIncoming, TExisting> {
  readonly creates: CreateEntry<TIncoming>[];
  readonly updates: UpdateEntry<TIncoming, TExisting>[];
  readonly unchanged: UnchangedEntry<TIncoming, TExisting>[];
  readonly conflicts: ConflictEntry<TIncoming, TExisting>[];
  readonly stats: ImportStats;
}
