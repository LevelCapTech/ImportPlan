/**
 * Value comparison for change detection.
 *
 * All comparisons are type-aware and perform no implicit coercion. The strict
 * (default) strategy is a structural deep-equality that:
 *
 * - ignores object property order but preserves array element order;
 * - treats arrays and objects as distinct types;
 * - compares valid `Date` instances by their UTC timestamp;
 * - reports unsupported values (functions, symbols, `Map`/`Set`, `RegExp`,
 *   class instances, non-finite numbers, invalid dates, accessor properties and
 *   circular references) instead of forcing a comparison.
 */
import type { CompareFunction, CompareRule, ConflictReason } from "../types.js";
import { isPlainObject, readOwnProperty } from "./object.js";

/** Result of comparing two present field values. */
export type CompareOutcome =
  | { readonly kind: "equal" }
  | { readonly kind: "changed" }
  | {
      readonly kind: "issue";
      readonly code: ConflictReason;
      readonly message: string;
      readonly cause?: unknown;
    };

const EQUAL: CompareOutcome = { kind: "equal" };
const CHANGED: CompareOutcome = { kind: "changed" };

/**
 * Compares an incoming (`after`) and existing (`before`) value using `rule`.
 * Both values are known to be present (own properties) when this is called.
 */
export function compareValues(
  rule: CompareRule,
  after: unknown,
  before: unknown,
): CompareOutcome {
  if (typeof rule === "function") {
    return compareCustom(rule, after, before);
  }
  switch (rule) {
    case "strict":
      return compareStrict(after, before);
    case "trim":
      return compareTrim(after, before);
    case "numeric":
      return compareNumeric(after, before);
    case "datetime":
      return compareDatetime(after, before);
    default:
      // Unreachable: unknown rules are rejected during option validation.
      return compareStrict(after, before);
  }
}

function compareStrict(after: unknown, before: unknown): CompareOutcome {
  if (containsUnsupported(after) || containsUnsupported(before)) {
    return {
      kind: "issue",
      code: "unsupported_value",
      message:
        "value contains something that cannot be safely compared (function, symbol, Map, Set, RegExp, class instance, non-finite number, invalid Date, accessor property, or circular reference)",
    };
  }
  return deepStrictEqual(after, before) ? EQUAL : CHANGED;
}

function compareTrim(after: unknown, before: unknown): CompareOutcome {
  if (typeof after !== "string" || typeof before !== "string") {
    return {
      kind: "issue",
      code: "invalid_comparable_value",
      message: 'the "trim" rule requires string values on both sides',
    };
  }
  return after.trim() === before.trim() ? EQUAL : CHANGED;
}

function compareNumeric(after: unknown, before: unknown): CompareOutcome {
  const a = toCanonicalDecimal(after);
  const b = toCanonicalDecimal(before);
  if (a === null || b === null) {
    return {
      kind: "issue",
      code: "invalid_comparable_value",
      message:
        'the "numeric" rule requires a finite number or a plain decimal string (no scientific notation, grouping separators, Infinity or NaN)',
    };
  }
  return a === b ? EQUAL : CHANGED;
}

function compareDatetime(after: unknown, before: unknown): CompareOutcome {
  const a = toInstant(after);
  const b = toInstant(before);
  if (a === null || b === null) {
    return {
      kind: "issue",
      code: "invalid_comparable_value",
      message:
        'the "datetime" rule requires a valid Date or an RFC 3339 date-time string with a timezone',
    };
  }
  return a === b ? EQUAL : CHANGED;
}

function compareCustom(
  fn: CompareFunction,
  after: unknown,
  before: unknown,
): CompareOutcome {
  let result: boolean;
  try {
    result = fn(after, before);
  } catch (error) {
    return {
      kind: "issue",
      code: "comparison_error",
      message: "custom comparison function threw an error",
      cause: error,
    };
  }
  if (result === true) {
    return EQUAL;
  }
  if (result === false) {
    return CHANGED;
  }
  return {
    kind: "issue",
    code: "comparison_error",
    message: "custom comparison function must return a boolean",
  };
}

/**
 * Deeply scans `value` for anything that cannot be safely compared, using
 * path-based cycle detection so circular references are reported rather than
 * causing infinite recursion. Shared (non-cyclic) references are allowed.
 */
export function containsUnsupported(value: unknown): boolean {
  return scan(value, new Set<object>());
}

function scan(value: unknown, path: Set<object>): boolean {
  switch (typeof value) {
    case "string":
    case "boolean":
    case "undefined":
    case "bigint":
      return false;
    case "number":
      return !Number.isFinite(value);
    case "symbol":
    case "function":
      return true;
    default:
      break;
  }
  if (value === null) {
    return false;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime());
  }
  const object = value as object;
  if (Array.isArray(value)) {
    if (path.has(object)) {
      return true;
    }
    path.add(object);
    for (const item of value) {
      if (scan(item, path)) {
        path.delete(object);
        return true;
      }
    }
    path.delete(object);
    return false;
  }
  if (isPlainObject(value)) {
    if (path.has(object)) {
      return true;
    }
    path.add(object);
    for (const key of Object.keys(value)) {
      const read = readOwnProperty(value, key);
      if (read.accessor || scan(read.value, path)) {
        path.delete(object);
        return true;
      }
    }
    path.delete(object);
    return false;
  }
  // Map, Set, WeakMap, WeakSet, RegExp, class instances, etc.
  return true;
}

/**
 * Structural equality for values already known to be free of unsupported
 * content. Property order is ignored; array order is significant.
 */
export function deepStrictEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (a === null || b === null) {
    return a === b;
  }
  if (typeof a !== "object") {
    return false;
  }
  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) {
    return false;
  }
  const aIsDate = a instanceof Date;
  const bIsDate = b instanceof Date;
  if (aIsDate || bIsDate) {
    return aIsDate && bIsDate && (a as Date).getTime() === (b as Date).getTime();
  }
  if (aIsArray) {
    const aArray = a as unknown[];
    const bArray = b as unknown[];
    if (aArray.length !== bArray.length) {
      return false;
    }
    for (let i = 0; i < aArray.length; i += 1) {
      if (!deepStrictEqual(aArray[i], bArray[i])) {
        return false;
      }
    }
    return true;
  }
  const aObject = a as Record<string, unknown>;
  const bObject = b as Record<string, unknown>;
  const aKeys = Object.keys(aObject);
  const bKeys = Object.keys(bObject);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    const bRead = readOwnProperty(bObject, key);
    if (!bRead.exists) {
      return false;
    }
    const aRead = readOwnProperty(aObject, key);
    if (!deepStrictEqual(aRead.value, bRead.value)) {
      return false;
    }
  }
  return true;
}

const DECIMAL_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
const EXPONENTIAL_RE = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/;
const RFC3339_RE =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/;

/**
 * Normalises a finite number or a plain decimal string to a canonical decimal
 * form so that `100`, `"100"` and `"100.00"` all compare equal. Returns `null`
 * for anything that is not an exact decimal value.
 */
export function toCanonicalDecimal(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    return canonicalizeDecimal(expandExponential(String(value)));
  }
  if (typeof value === "string") {
    if (!DECIMAL_RE.test(value)) {
      return null;
    }
    return canonicalizeDecimal(value);
  }
  return null;
}

function expandExponential(text: string): string {
  const match = EXPONENTIAL_RE.exec(text);
  if (match === null) {
    return text;
  }
  const sign = match[1] ?? "";
  const intDigits = match[2] as string;
  const fracDigits = match[3] ?? "";
  const exponent = Number.parseInt(match[4] as string, 10);
  const digits = intDigits + fracDigits;
  const pointPosition = intDigits.length + exponent;
  let magnitude: string;
  if (pointPosition <= 0) {
    magnitude = `0.${"0".repeat(-pointPosition)}${digits}`;
  } else if (pointPosition >= digits.length) {
    magnitude = digits + "0".repeat(pointPosition - digits.length);
  } else {
    magnitude = `${digits.slice(0, pointPosition)}.${digits.slice(pointPosition)}`;
  }
  return sign + magnitude;
}

function canonicalizeDecimal(text: string): string | null {
  if (!DECIMAL_RE.test(text)) {
    return null;
  }
  const negative = text.startsWith("-");
  const unsigned = text.startsWith("+") || negative ? text.slice(1) : text;
  const dotIndex = unsigned.indexOf(".");
  let integerPart = dotIndex === -1 ? unsigned : unsigned.slice(0, dotIndex);
  let fractionPart = dotIndex === -1 ? "" : unsigned.slice(dotIndex + 1);
  integerPart = integerPart.replace(/^0+/, "");
  if (integerPart === "") {
    integerPart = "0";
  }
  fractionPart = fractionPart.replace(/0+$/, "");
  const magnitude = fractionPart === "" ? integerPart : `${integerPart}.${fractionPart}`;
  if (magnitude === "0") {
    return "0";
  }
  return negative ? `-${magnitude}` : magnitude;
}

/** Resolves a value to a UTC millisecond instant, or `null` when it is not a valid instant. */
export function toInstant(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value === "string") {
    const match = RFC3339_RE.exec(value);
    if (match === null || !isValidRfc3339Calendar(match)) {
      return null;
    }
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : time;
  }
  return null;
}

/**
 * Validates the calendar fields of a matched RFC 3339 string so that impossible
 * dates (e.g. February 30th) are rejected instead of being silently rolled over
 * by `Date.parse`.
 */
function isValidRfc3339Calendar(match: RegExpExecArray): boolean {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12) {
    return false;
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return false;
  }
  // A leap second (:60) is tolerated per RFC 3339; everything else must be in range.
  return hour <= 23 && minute <= 59 && second <= 60;
}

/** Number of days in a 1-based month of the given proleptic Gregorian year. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
