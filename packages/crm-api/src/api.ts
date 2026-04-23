/**
 * Re-export of the generated Convex API for spoke-site consumption.
 *
 * Source of truth lives in angelsrest/convex/_generated/api. This file is
 * resolved via the package's `./api` subpath export; consumers should prefer
 * `import { api } from "@jessepomeroy/crm-api/api"` (or rely on the SvelteKit
 * `$convex/api` alias that maps to it).
 */
export * from "../../../convex/_generated/api";
