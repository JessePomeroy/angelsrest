# @jessepomeroy/print-catalog

Shared LumaPrints catalog, pricing, and margin helpers for the photographer CRM platform.

This package is intentionally in-process: it has no runtime dependencies and no network access. Sites and editors should import it directly instead of maintaining copied catalog files.

## Exports

- `@jessepomeroy/print-catalog`: papers, sizes, borders, frames, canvas options, LumaPrints IDs, wholesale lookup helpers, and editor option helpers.
- `@jessepomeroy/print-catalog/configurator`: client-safe variant option lists, finish normalization, display pricing, and fulfillment metadata. Checkout must still validate the selection server-side.
- `@jessepomeroy/print-catalog/pricing`: Stripe/platform fee math and margin summary helpers for editor fields.
