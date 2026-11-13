import type { Id } from "./_generated/dataModel";

// The `emailLog` table is written by `documentEmailAttempts.ts`. This module no
// longer registers public functions; it keeps the row type helper below.

/**
 * Type-level contract between `emailLog.type` and `emailLog.relatedId`
 * (audit M11). `relatedId` is stored as `v.string()` in the schema so
 * existing rows don't require a migration, but when present it should be
 * the Convex Id of the document denoted by `type`.
 *
 * Use this map when reading a row back to cast `relatedId` to a typed
 * `Id<...>`:
 *
 *     const id = row.relatedId as RelatedIdFor<typeof row.type>;
 *
 * `reminder` and `custom` do not reference a specific document; their
 * `relatedId` should be omitted.
 */
export type RelatedIdFor<T extends "invoice" | "quote" | "contract" | "reminder" | "custom"> =
	T extends "invoice"
		? Id<"invoices">
		: T extends "quote"
			? Id<"quotes">
			: T extends "contract"
				? Id<"contracts">
				: undefined;
