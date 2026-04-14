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

	cookies.set("__sanity_preview", "true", {
		path: "/",
		httpOnly: true,
		sameSite: "none",
		secure: true,
	});

	throw redirect(307, redirectTo);
}
