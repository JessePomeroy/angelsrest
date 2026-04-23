/**
 * Default entry for `@jessepomeroy/crm-api`. Re-exports the Convex `api`
 * object so `import { api } from "@jessepomeroy/crm-api"` works, while
 * subpath imports (`/api`, `/dataModel`, `/server`) are still available for
 * callers that want to be explicit.
 */
export * from "./api";
