import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import {
	isTenantSiteSegment,
	parseTenantSecretRegistry,
	tenantSecretMatches,
} from "./helpers/serverSecrets";

const http = httpRouter();

const CMS_MEDIA_COMPLETION_PATH = "/cms-media/complete-deletion";
const MAX_COMPLETION_BODY_BYTES = 4096;
const CMS_MEDIA_ASSET_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function completionResponse(body: string | object, status: number) {
	return typeof body === "string"
		? new Response(body, {
			status,
			headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
		})
		: Response.json(body, {
			status,
			headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
		});
}

async function readCompletionBody(request: Request) {
	const contentLength = Number(request.headers.get("Content-Length"));
	if (Number.isFinite(contentLength) && contentLength > MAX_COMPLETION_BODY_BYTES) return null;
	const text = await request.text();
	if (new TextEncoder().encode(text).byteLength > MAX_COMPLETION_BODY_BYTES) return null;
	try {
		const value = JSON.parse(text) as unknown;
		return value && typeof value === "object" && !Array.isArray(value)
			? value as Record<string, unknown>
			: null;
	} catch {
		return null;
	}
}

const completeCmsMediaDeletion = httpAction(async (ctx, request) => {
	const registry = parseTenantSecretRegistry(
		process.env.CMS_MEDIA_DELETION_COMPLETION_SECRETS,
	);
	if (!registry) return completionResponse("CMS media completion is not configured", 503);
	if (request.headers.get("Content-Type")?.split(";", 1)[0]?.trim() !== "application/json") {
		return completionResponse("Invalid request", 400);
	}
	const body = await readCompletionBody(request);
	const siteUrl = body?.siteUrl;
	const id = body?.id;
	const assetId = body?.assetId;
	if (
		!isTenantSiteSegment(siteUrl)
		|| typeof id !== "string"
		|| id.length < 1
		|| id.length > 128
		|| typeof assetId !== "string"
		|| !CMS_MEDIA_ASSET_ID_PATTERN.test(assetId)
	) return completionResponse("Invalid request", 400);
	const authorization = request.headers.get("Authorization") ?? "";
	const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
	if (!supplied || !(await tenantSecretMatches(registry, siteUrl, supplied))) {
		return completionResponse("Unauthorized", 401);
	}

	try {
		await ctx.runMutation(internal.mediaAssets.completeDeletion, {
			siteUrl,
			id: id as Id<"mediaAssets">,
			assetId,
		});
		return completionResponse({ deleted: true, id }, 200);
	} catch {
		console.error(JSON.stringify({
			event: "cms.media_completion_failed",
			siteUrl,
			code: "completion_rejected",
		}));
		return completionResponse("CMS media deletion could not be completed", 409);
	}
});

authComponent.registerRoutes(http, createAuth);
http.route({
	path: CMS_MEDIA_COMPLETION_PATH,
	method: "POST",
	handler: completeCmsMediaDeletion,
});

export default http;
