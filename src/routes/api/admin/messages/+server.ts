import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { getConvex } from "$lib/server/convexClient";
import { trimString } from "$lib/server/validation";
import type { RequestHandler } from "./$types";

const convex = getConvex();

export const GET: RequestHandler = async ({ url }) => {
	const siteUrl = url.searchParams.get("siteUrl");
	if (!siteUrl) return json({ error: "missing siteUrl" }, { status: 400 });
	const messages = await convex.query(api.messages.list, { siteUrl });
	return json({ messages });
};

export const POST: RequestHandler = async ({ request }) => {
	const { siteUrl, content } = await request.json();

	if (!siteUrl) {
		throw error(400, "siteUrl is required");
	}

	const trimmedContent = trimString(content, 5000);
	if (!trimmedContent) {
		throw error(400, "content is required");
	}

	await convex.mutation(api.messages.send, {
		siteUrl,
		sender: "creator",
		content: trimmedContent,
	});
	return json({ success: true });
};

export const PATCH: RequestHandler = async ({ request }) => {
	const { siteUrl } = await request.json();
	if (!siteUrl) {
		throw error(400, "siteUrl is required");
	}
	await convex.mutation(api.messages.markRead, { siteUrl });
	return json({ success: true });
};
