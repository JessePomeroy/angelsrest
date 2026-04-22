import { createClient } from "@sanity/client";
import { validatePreviewUrl } from "@sanity/preview-url-secret";
import { redirect } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";

const client = createClient({
	projectId: publicEnv.PUBLIC_SANITY_PROJECT_ID,
	dataset: publicEnv.PUBLIC_SANITY_DATASET || "production",
	apiVersion: "2024-01-01",
	useCdn: false,
	token: env.SANITY_PREVIEW_TOKEN,
});

export async function GET({ url, cookies }) {
	const { isValid, redirectTo = "/" } = await validatePreviewUrl(client, url.toString());

	if (!isValid) {
		return new Response("Invalid preview URL", { status: 403 });
	}

	// SameSite=Lax prevents the preview cookie from being sent on cross-site
	// requests. Previously this was `"none"` which meant any third-party site
	// could trigger the browser to hit us with preview-mode enabled.
	//
	// Sanity's Presentation iframe runs on the same-site Vercel deployment
	// (or redirects the top-level window), so Lax is sufficient. If a future
	// use-case requires third-party iframe embedding of preview pages, use
	// `sameSite: "none"` ONLY paired with `partitioned: true` (CHIPS) and a
	// CSRF-protected toggle, never both unrestricted.
	cookies.set("__sanity_preview", "true", {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		secure: true,
	});

	throw redirect(307, redirectTo);
}
