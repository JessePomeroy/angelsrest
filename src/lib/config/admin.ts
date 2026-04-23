import type { AdminConfig } from "@jessepomeroy/admin";
import { api } from "$convex/api";

// Map Convex's `galleries` namespace to the package's `galleryDelivery` key —
// the admin package renamed this to match the feature flag name; Convex module
// names stay as `galleries` since they predate the rename.
//
// IMPORTANT: `api` is `anyApi` from `convex/server`, which is implemented as a
// Proxy with NO own enumerable properties. Spreading it with `{ ...api, ... }`
// produces a plain object that contains only the explicit overrides — every
// other namespace (`crm`, `orders`, `invoices`, ...) becomes undefined and the
// admin dashboard crashes on first render with
// `Cannot read properties of undefined (reading 'getStats')`.
//
// Use a Proxy wrapper instead so unknown property reads fall through to the
// real `api` Proxy and the alias is the only override.
const apiWithGalleryDelivery = new Proxy(api, {
	get(target, prop, receiver) {
		if (prop === "galleryDelivery") return target.galleries;
		return Reflect.get(target, prop, receiver);
	},
}) as typeof api & { galleryDelivery: typeof api.galleries };

export const adminConfig: AdminConfig = {
	siteUrl: "angelsrest.online",
	siteName: "angel's rest",
	fromEmail: "Angel's Rest <noreply@angelsrest.online>",
	isCreator: true,
	sanityStudioUrl: "https://angelsrest.sanity.studio",
	galleryWorkerUrl: "https://gallery-worker.thinkingofview.workers.dev",
	api: apiWithGalleryDelivery,
	// Route mutations through the SvelteKit proxy at /api/admin/mutation
	// instead of the Convex WebSocket. The browser socket is intentionally
	// unauthenticated (see admin/+layout.svelte) to avoid the pause bug in
	// `@mmailaender/convex-better-auth-svelte@0.7.3` + `better-auth@1.5.x`
	// during SvelteKit client-side navigation.
	mutationTransport: "http",
};
