/**
 * `@levelcap/import-plan`
 *
 * Generate safe, deterministic data import plans (creates / updates /
 * unchanged / conflicts) by diffing two record arrays. Zero runtime
 * dependencies; no side effects.
 */
export { planImport } from "./planImport.js";
export { ImportPlanInputError, isImportPlanInputError } from "./errors.js";

export type {
  CandidateOperation,
  CommonKey,
  CompareFunction,
  CompareRule,
  ConflictEntry,
  ConflictIssue,
  ConflictReason,
  CreateEntry,
  FieldChange,
  ImportPlanOptions,
  ImportPlanResult,
  ImportStats,
  KeyInput,
  KeyScalar,
  KeyValue,
  UnchangedEntry,
  UpdateEntry,
} from "./types.js";
