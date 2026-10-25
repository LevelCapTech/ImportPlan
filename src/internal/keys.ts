/**
 * Key extraction, validation and a collision-free encoding used to group
 * records by their (single or composite) matching key.
 *
 * The encoding is a self-delimiting, type-tagged representation so that keys
 * never collide by accident:
 *
 * - different types never collide: `1` (number) vs `"1"` (string) vs `true`;
 * - composite components keep their boundaries: `["a:b", "c"]` differs from
 *   `["a", "b:c"]` because each component is length-prefixed.
 *
 * No implicit coercion, case-folding or trimming is performed. `0` and `-0` are
 * treated as the same key (per spec); `NaN`, `Infinity`, `null`, `undefined`,
 * blank strings, objects, arrays, functions and symbols are all invalid keys.
 */
import type { KeyScalar, KeyValue } from "../types.js";
import { readOwnProperty } from "./object.js";

/** Outcome of validating a single candidate key component value. */
export type KeyComponentResult =
  | { readonly ok: true; readonly value: KeyScalar }
  | { readonly ok: false; readonly reason: string };

/** Outcome of resolving a record's full (single or composite) key. */
export type KeyResult =
  | { readonly ok: true; readonly components: KeyScalar[]; readonly encoded: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Validates a single key component value. Accepts non-blank strings, finite
 * numbers and booleans. Everything else (including `NaN`, `Infinity`, blank or
 * whitespace-only strings, `null`, `undefined`, `bigint`, objects, arrays,
 * functions and symbols) is rejected.
 */
export function validateKeyScalar(value: unknown): KeyComponentResult {
  switch (typeof value) {
    case "string":
      if (value.trim().length === 0) {
        return { ok: false, reason: "key string is empty or whitespace-only" };
      }
      return { ok: true, value };
    case "number":
      if (!Number.isFinite(value)) {
        return { ok: false, reason: "key number is NaN or infinite" };
      }
      return { ok: true, value };
    case "boolean":
      return { ok: true, value };
    default:
      return { ok: false, reason: `key value has unsupported type "${describe(value)}"` };
  }
}

function describe(value: unknown): string {
  if (value === null) {
    return "null";
  }
  return typeof value;
}

/** Encodes a single validated key component into a self-delimiting token. */
function encodeComponent(value: KeyScalar): string {
  if (typeof value === "string") {
    return `s${value.length}:${value}`;
  }
  if (typeof value === "number") {
    // `-0` and `0` share the same canonical form.
    const text = Object.is(value, -0) ? "0" : String(value);
    return `n${text.length}:${text}`;
  }
  return value ? "b:1" : "b:0";
}

/** Encodes an ordered list of validated key components into one injective string. */
export function encodeKey(components: readonly KeyScalar[]): string {
  let encoded = "";
  for (const component of components) {
    encoded += encodeComponent(component);
  }
  return encoded;
}

/**
 * Resolves the key of `record` given the (already validated) list of key
 * fields. Reads only own, non-accessor properties.
 */
export function resolveKey(record: object, keyFields: readonly string[]): KeyResult {
  const components: KeyScalar[] = [];
  for (const field of keyFields) {
    const read = readOwnProperty(record, field);
    if (!read.exists) {
      return { ok: false, reason: `missing key field "${field}"` };
    }
    if (read.accessor) {
      return { ok: false, reason: `key field "${field}" is an accessor property` };
    }
    const scalar = validateKeyScalar(read.value);
    if (!scalar.ok) {
      return { ok: false, reason: `invalid key field "${field}": ${scalar.reason}` };
    }
    components.push(scalar.value);
  }
  return { ok: true, components, encoded: encodeKey(components) };
}

/**
 * Builds the public-facing key value for a resolved key: the raw scalar for a
 * single-field key, or a safe object keyed by field name for a composite key.
 */
export function toKeyValue(
  keyFields: readonly string[],
  components: readonly KeyScalar[],
  isComposite: boolean,
): KeyValue {
  if (!isComposite) {
    return components[0] as KeyScalar;
  }
  const result: Record<string, KeyScalar> = {};
  for (let i = 0; i < keyFields.length; i += 1) {
    // `defineProperty` keeps dangerous field names (e.g. "__proto__") as plain
    // own data properties instead of mutating any prototype.
    Object.defineProperty(result, keyFields[i] as string, {
      value: components[i] as KeyScalar,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return result;
}
