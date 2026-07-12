# `@jessepomeroy/gallery-delivery`

Shared browser-side behavior for private client gallery delivery hosts.

The package owns download planning, download destinations, streamed browser ZIP creation, prepared ZIP orchestration, display-image derivation, file-type policy, and concurrency-safe optimistic favorite state.

Host applications remain responsible for Svelte components, branding, copy, routes, authentication cookies, Convex calls, and Worker configuration. Import the narrow subpath that owns the behavior you need, for example:

```ts
import { createGalleryDownloadPlan } from "@jessepomeroy/gallery-delivery/download-plan";
```
