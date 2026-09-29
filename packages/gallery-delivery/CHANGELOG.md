# @jessepomeroy/gallery-delivery

## 0.3.0

### Minor Changes

- 501ce7f: Add authorized delivery metadata pages and resumable preview-index preparation;
  preserve RAW companions across pages. Maintain per-currency order totals with a
  resumable, independently reconciled historical backfill and day-sensitive query.
  The host must prepare existing gallery indexes before adopting pagination.

## 0.2.1

### Patch Changes

- 8a87219: Centralize chosen-file write, close and abort handling across browser ZIP, folder
  and prepared ZIP downloads. Preserve existing save interfaces, streaming,
  cancellation reasons, picker timing and progress behavior.

## 0.2.0

### Minor Changes

- 955c0fa: Add protected delivery-gallery video playback and media classification.

## 0.1.0

### Minor Changes

- 61fe017: Publish the shared browser gallery-delivery behavior used by photographer CRM hosts.
