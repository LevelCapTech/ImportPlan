import type { ImportPlanOptions, ImportPlanResult } from "./types.js";
import { normalizeOptions } from "./internal/options.js";
import { buildPlan } from "./internal/plan.js";

/**
 * Builds a safe, deterministic import plan by comparing `incoming` records
 * against an `existing` snapshot, matching them by `key`.
 *
 * The function is pure and synchronous: it never mutates its inputs, performs no
 * I/O, and returns the same result for the same inputs. Records are classified
 * into `creates`, `updates`, `unchanged` and `conflicts`; existing records with
 * no corresponding incoming key are ignored (never deleted).
 *
 * @example
 * ```ts
 * const plan = planImport({ incoming: csvData, existing: dbData, key: "id" });
 * console.log(plan.creates, plan.updates, plan.unchanged, plan.conflicts);
 * ```
 *
 * @throws {@link ImportPlanInputError} for configuration or whole-input problems
 * (for example a non-array input, an invalid `key`, overlapping
 * `protectedFields`/`ignoreFields`, an unknown `compare` rule, or an existing
 * record that cannot be matched because it has no valid key).
 */
export function planImport<
  TIncoming extends object = Record<string, unknown>,
  TExisting extends object = Record<string, unknown>,
>(options: ImportPlanOptions<TIncoming, TExisting>): ImportPlanResult<TIncoming, TExisting> {
  const normalized = normalizeOptions(options);
  return buildPlan(normalized) as ImportPlanResult<TIncoming, TExisting>;
}
