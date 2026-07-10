/**
 * Site-facing compatibility facade for the shared print catalog package.
 *
 * Keep this module so existing `$lib/shop/printCatalog` imports remain stable
 * while the actual LumaPrints catalog data lives in `@jessepomeroy/print-catalog`.
 */

export * from "@jessepomeroy/print-catalog";
