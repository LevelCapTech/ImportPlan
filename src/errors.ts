/**
 * Error thrown for configuration or whole-input problems that prevent a plan
 * from being produced safely (as opposed to per-record conflicts, which are
 * returned in {@link ImportPlanResult.conflicts}).
 *
 * Examples: `incoming`/`existing` is not an array, an invalid `key` option, a
 * `protectedFields`/`ignoreFields` overlap, an unknown `compare` rule, or an
 * existing record that has no valid key and therefore cannot be matched.
 */
export class ImportPlanInputError extends Error {
  /** Stable discriminator so the error can be identified across realms/bundles. */
  readonly code = "IMPORT_PLAN_INPUT_ERROR" as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "ImportPlanInputError";
    if (options && "cause" in options) {
      // Preserve the original error without relying on the Error `cause`
      // constructor option (not available on every supported runtime).
      (this as { cause?: unknown }).cause = options.cause;
    }
    // Restore the prototype chain for environments that down-compile classes.
    Object.setPrototypeOf(this, ImportPlanInputError.prototype);
  }
}

/** Type guard for {@link ImportPlanInputError} that is resilient to multiple copies of the library. */
export function isImportPlanInputError(value: unknown): value is ImportPlanInputError {
  return (
    value instanceof ImportPlanInputError ||
    (typeof value === "object" &&
      value !== null &&
      (value as { code?: unknown }).code === "IMPORT_PLAN_INPUT_ERROR")
  );
}
