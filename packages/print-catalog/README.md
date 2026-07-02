# @jessepomeroy/print-catalog

Shared LumaPrints catalog, pricing, and margin helpers for the photographer CRM platform.

This package is intentionally in-process: it has no runtime dependencies and no network access. Sites and Sanity Studios should import it directly instead of maintaining copied `printCatalog.ts` files.

## Exports

- `@jessepomeroy/print-catalog`: papers, sizes, borders, frames, canvas options, LumaPrints IDs, wholesale lookup helpers, and Sanity dropdown helpers.
- `@jessepomeroy/print-catalog/pricing`: Stripe/platform fee math and margin summary helpers for Studio custom fields.
