/**
 * Low-level, side-effect-free helpers for safely reading from untrusted records
 * and for building result objects without risking prototype pollution.
 */

/** Property names that must never be written to a normal object via assignment. */
const FORBIDDEN_WRITE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/** Result of reading a single own property from a record. */
export interface OwnPropertyRead {
  /** Whether the property exists as an own property. */
  readonly exists: boolean;
  /** The property value (only meaningful when `exists` is `true` and `accessor` is `false`). */
  readonly value: unknown;
  /** Whether the property is a getter/setter (reading it could cause side effects). */
  readonly accessor: boolean;
}

const ABSENT: OwnPropertyRead = { exists: false, value: undefined, accessor: false };

/**
 * Reads an own property without invoking accessors and without traversing the
 * prototype chain. Accessor (getter/setter) properties are reported via the
 * `accessor` flag so callers can treat them as unsupported rather than trigger
 * side effects.
 */
export function readOwnProperty(target: object, key: string): OwnPropertyRead {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor === undefined) {
    return ABSENT;
  }
  if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
    return { exists: true, value: undefined, accessor: true };
  }
  return { exists: true, value: descriptor.value, accessor: false };
}

/**
 * Returns the own, enumerable, string-keyed property names of `target`.
 *
 * Mirrors `Object.keys` but is centralised so the traversal strategy is
 * consistent across the library.
 */
export function ownEnumerableKeys(target: object): string[] {
  return Object.keys(target);
}

/**
 * Whether `value` is a non-null object that is not an array. Used to decide
 * whether an array entry is a usable record container.
 */
export function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether `value` is a "plain" object (created from `{}`, `Object.create(null)`
 * or `new Object()`), as opposed to an array, class instance, `Date`, `Map`, etc.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === null || proto === Object.prototype;
}

/**
 * Creates a result object (such as a `patch`) populated from `[key, value]`
 * pairs, using `Object.defineProperty` so that dangerous keys like `__proto__`
 * become plain own data properties instead of polluting any prototype.
 */
export function createSafeObject(
  entries: Iterable<readonly [string, unknown]>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    defineDataProperty(result, key, value);
  }
  return result;
}

/** Defines an enumerable, writable, configurable data property, bypassing setters. */
export function defineDataProperty(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (FORBIDDEN_WRITE_KEYS.has(key)) {
    Object.defineProperty(target, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    return;
  }
  target[key] = value;
}
