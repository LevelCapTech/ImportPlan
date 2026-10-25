/**
 * Validation and normalisation of {@link ImportPlanOptions}.
 *
 * Whole-input / configuration problems throw {@link ImportPlanInputError};
 * per-record problems are handled later and surfaced as conflicts.
 */
import type { CompareRule } from "../types.js";
import { ImportPlanInputError } from "../errors.js";
import { isRecordObject, readOwnProperty } from "./object.js";

const KNOWN_RULES = new Set(["strict", "trim", "numeric", "datetime"]);

/** Options after validation, in a form convenient for the planning algorithm. */
export interface NormalizedOptions {
  readonly incoming: readonly unknown[];
  readonly existing: readonly unknown[];
  readonly keyFields: string[];
  readonly isComposite: boolean;
  readonly keyFieldSet: Set<string>;
  readonly protectedFields: Set<string>;
  readonly ignoreFields: Set<string>;
  readonly compare: Map<string, CompareRule>;
}

export function normalizeOptions(options: unknown): NormalizedOptions {
  if (!isRecordObject(options)) {
    throw new ImportPlanInputError("planImport() requires an options object.");
  }

  if (!Array.isArray(options.incoming)) {
    throw new ImportPlanInputError('"incoming" must be an array.');
  }
  if (!Array.isArray(options.existing)) {
    throw new ImportPlanInputError('"existing" must be an array.');
  }

  const { keyFields, isComposite } = normalizeKey(options.key);
  const keyFieldSet = new Set(keyFields);

  const protectedFields = normalizeFieldList(options.protectedFields, "protectedFields");
  const ignoreFields = normalizeFieldList(options.ignoreFields, "ignoreFields");

  for (const field of protectedFields) {
    if (ignoreFields.has(field)) {
      throw new ImportPlanInputError(
        `Field "${field}" cannot appear in both "protectedFields" and "ignoreFields".`,
      );
    }
  }

  const compare = normalizeCompare(options.compare);

  return {
    incoming: options.incoming as readonly unknown[],
    existing: options.existing as readonly unknown[],
    keyFields,
    isComposite,
    keyFieldSet,
    protectedFields,
    ignoreFields,
    compare,
  };
}

function normalizeKey(key: unknown): { keyFields: string[]; isComposite: boolean } {
  if (typeof key === "string") {
    if (key.length === 0) {
      throw new ImportPlanInputError('"key" must be a non-empty field name.');
    }
    return { keyFields: [key], isComposite: false };
  }
  if (Array.isArray(key)) {
    if (key.length === 0) {
      throw new ImportPlanInputError('"key" array must contain at least one field name.');
    }
    const seen = new Set<string>();
    const keyFields: string[] = [];
    for (const field of key) {
      if (typeof field !== "string" || field.length === 0) {
        throw new ImportPlanInputError(
          '"key" array entries must be non-empty field names.',
        );
      }
      if (seen.has(field)) {
        throw new ImportPlanInputError(
          `"key" array contains the duplicate field "${field}".`,
        );
      }
      seen.add(field);
      keyFields.push(field);
    }
    return { keyFields, isComposite: true };
  }
  throw new ImportPlanInputError(
    '"key" must be a field name or an array of field names.',
  );
}

function normalizeFieldList(value: unknown, optionName: string): Set<string> {
  if (value === undefined) {
    return new Set();
  }
  if (!Array.isArray(value)) {
    throw new ImportPlanInputError(`"${optionName}" must be an array of field names.`);
  }
  const result = new Set<string>();
  for (const field of value) {
    if (typeof field !== "string" || field.length === 0) {
      throw new ImportPlanInputError(
        `"${optionName}" entries must be non-empty field names.`,
      );
    }
    result.add(field);
  }
  return result;
}

function normalizeCompare(value: unknown): Map<string, CompareRule> {
  const result = new Map<string, CompareRule>();
  if (value === undefined) {
    return result;
  }
  if (!isRecordObject(value)) {
    throw new ImportPlanInputError('"compare" must be an object mapping fields to rules.');
  }
  for (const field of Object.keys(value)) {
    const read = readOwnProperty(value, field);
    const rule = read.value;
    if (typeof rule === "function") {
      result.set(field, rule as CompareRule);
      continue;
    }
    if (typeof rule === "string" && KNOWN_RULES.has(rule)) {
      result.set(field, rule as CompareRule);
      continue;
    }
    throw new ImportPlanInputError(
      `Unknown comparison rule for field "${field}". Use "strict", "trim", "numeric", "datetime", or a function.`,
    );
  }
  return result;
}
