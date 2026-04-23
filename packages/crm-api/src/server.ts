/**
 * Re-export of the generated Convex server types (QueryCtx, MutationCtx, etc.).
 *
 * Most spoke sites won't need this — it's intended for future internal tooling
 * that needs to author Convex functions against the shared schema.
 */
export * from "../../../convex/_generated/server";
