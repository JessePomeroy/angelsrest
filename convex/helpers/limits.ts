/**
 * Named `.take()` limits for Convex queries (audit M13).
 *
 * These constants make intent legible — "why is this capped at 500?" —
 * and give us a single place to change the cap when a workload outgrows
 * it. Every limit is chosen to stay well below Convex's per-query
 * document cap (~16k).
 *
 * For true streaming, use `.paginate()` instead; these constants are
 * one-shot upper bounds for queries that return a complete-enough result
 * without pagination UI.
 *
 * Sentinel values like `.take(1)` (take the top row) are left inline —
 * wrapping them in a constant obscures intent rather than clarifying it.
 */

/** Inline "recent" previews — notification feeds, activity peek. */
export const RECENT_ITEMS_LIMIT = 10;

/** Compact admin secondary lists — galleries by client, board configs. */
export const COMPACT_LIST_LIMIT = 50;

/** Default limit for admin UI list views — standard table rows. */
export const DEFAULT_LIST_LIMIT = 100;

/** Lookup-style tables — tag picker, small reference lists. */
export const LOOKUP_LIMIT = 200;

/** Bulk read-scan — mark-all-read, client enumeration, email templates. */
export const BULK_SCAN_LIMIT = 500;

/** Large single-doc history reads — download stats, activity feeds. */
export const LARGE_SCAN_LIMIT = 1000;

/** Per-gallery image cap — one gallery's worst-case image count. */
export const GALLERY_IMAGE_LIMIT = 2000;

/** Site-wide aggregation scans — stats, revenue rollups. */
export const AGGREGATE_SCAN_LIMIT = 5000;
