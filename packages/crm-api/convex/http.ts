import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import type {
	CatalogPrivateInspectionReceiptSet,
	CatalogPrivateStorageReceiptSet,
} from "./helpers/catalogPrivateAssetReceiptContract";
import {
	CATALOG_PRIVATE_ASSET_RECEIPT_SET_V2_VERSION,
	CATALOG_PRIVATE_ASSET_RECEIPT_SET_VERSION,
} from "./helpers/catalogPrivateAssetReceiptContract";
import {
	isServerSecretCandidate,
	isTenantSiteSegment,
	parseTenantSecretRegistry,
	tenantSecretRegistriesAreDisjoint,
	tenantSecretMatches,
} from "./helpers/serverSecrets";

const http = httpRouter();

const CMS_MEDIA_COMPLETION_PATH = "/cms-media/complete-deletion";
const MAX_COMPLETION_BODY_BYTES = 4096;
const CATALOG_STORAGE_RECEIPT_PATH = "/cms-media/catalog-private-assets/storage-receipt";
const CATALOG_INSPECTION_RECEIPT_PATH =
	"/cms-media/catalog-private-assets/inspection-receipt";
const MAX_CATALOG_RECEIPT_BODY_BYTES = 256 * 1024;
const CMS_MEDIA_ASSET_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function privateResponse(body: string | object, status: number) {
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

async function readJsonObject(request: Request, maximumBytes: number) {
	const contentLengthHeader = request.headers.get("Content-Length");
	if (contentLengthHeader !== null) {
		const contentLength = Number(contentLengthHeader);
		if (
			!Number.isSafeInteger(contentLength)
			|| contentLength < 0
			|| contentLength > maximumBytes
		) return null;
	}
	if (!request.body) return null;
	const reader = request.body.getReader();
	const decoder = new TextDecoder();
	let byteLength = 0;
	let text = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			byteLength += value.byteLength;
			if (byteLength > maximumBytes) {
				await reader.cancel();
				return null;
			}
			text += decoder.decode(value, { stream: true });
		}
		text += decoder.decode();
	} catch {
		return null;
	} finally {
		reader.releaseLock();
	}
	try {
		const value = JSON.parse(text) as unknown;
		return value && typeof value === "object" && !Array.isArray(value)
			? value as Record<string, unknown>
			: null;
	} catch {
		return null;
	}
}

function bearerToken(request: Request) {
	const authorization = request.headers.get("Authorization") ?? "";
	return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

function catalogReceiptRegistries() {
	const storage = parseTenantSecretRegistry(
		process.env.CATALOG_PRIVATE_ASSET_STORAGE_RECEIPT_SECRETS,
	);
	const inspection = parseTenantSecretRegistry(
		process.env.CATALOG_PRIVATE_ASSET_INSPECTION_RECEIPT_SECRETS,
	);
	return storage && inspection && tenantSecretRegistriesAreDisjoint(storage, inspection)
		? { storage, inspection }
		: null;
}

function isReceiptSetEnvelope(body: Record<string, unknown>) {
	return Object.keys(body).length === 4
		&& (
			body.schemaVersion === CATALOG_PRIVATE_ASSET_RECEIPT_SET_VERSION
			|| body.schemaVersion === CATALOG_PRIVATE_ASSET_RECEIPT_SET_V2_VERSION
		)
		&& typeof body.receiptSetId === "string"
		&& isTenantSiteSegment(body.siteUrl)
		&& Array.isArray(body.receipts);
}

const completeCmsMediaDeletion = httpAction(async (ctx, request) => {
	const registry = parseTenantSecretRegistry(
		process.env.CMS_MEDIA_DELETION_COMPLETION_SECRETS,
	);
	if (!registry) return privateResponse("CMS media completion is not configured", 503);
	if (request.headers.get("Content-Type")?.split(";", 1)[0]?.trim() !== "application/json") {
		return privateResponse("Invalid request", 400);
	}
	const supplied = bearerToken(request);
	if (!isServerSecretCandidate(supplied)) return privateResponse("Unauthorized", 401);
	const body = await readJsonObject(request, MAX_COMPLETION_BODY_BYTES);
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
	) return privateResponse("Invalid request", 400);
	if (!(await tenantSecretMatches(registry, siteUrl, supplied))) {
		return privateResponse("Unauthorized", 401);
	}

	try {
		await ctx.runMutation(internal.mediaAssets.completeDeletion, {
			siteUrl,
			id: id as Id<"mediaAssets">,
			assetId,
		});
		return privateResponse({ deleted: true, id }, 200);
	} catch {
		console.error(JSON.stringify({
			event: "cms.media_completion_failed",
			siteUrl,
			code: "completion_rejected",
		}));
		return privateResponse("CMS media deletion could not be completed", 409);
	}
});

function catalogReceiptHandler(role: "storage" | "inspection") {
	return httpAction(async (ctx, request) => {
		const registries = catalogReceiptRegistries();
		if (!registries) {
			return privateResponse("Private catalog receipt roles are not configured", 503);
		}
		if (request.headers.get("Content-Type")?.split(";", 1)[0]?.trim() !== "application/json") {
			return privateResponse("Invalid request", 400);
		}
		const supplied = bearerToken(request);
		if (!isServerSecretCandidate(supplied)) return privateResponse("Unauthorized", 401);
		const body = await readJsonObject(request, MAX_CATALOG_RECEIPT_BODY_BYTES);
		if (!body || !isReceiptSetEnvelope(body)) return privateResponse("Invalid request", 400);
		const siteUrl = body.siteUrl as string;
		if (!(await tenantSecretMatches(registries[role], siteUrl, supplied))) {
			return privateResponse("Unauthorized", 401);
		}
		try {
			const result = role === "storage"
				? await ctx.runMutation(internal.catalogPrivateAssets.recordStorageReceiptSet, {
						receiptSet: body as unknown as CatalogPrivateStorageReceiptSet,
					})
				: await ctx.runMutation(internal.catalogPrivateAssets.recordInspectionReceiptSet, {
						receiptSet: body as unknown as CatalogPrivateInspectionReceiptSet,
					});
			return privateResponse(result, 200);
		} catch {
			console.error(JSON.stringify({
				event: "cms.catalog_private_receipt_rejected",
				role,
				siteUrl,
				code: "receipt_conflict",
			}));
			return privateResponse(
				`Private catalog ${role} receipt could not be accepted`,
				409,
			);
		}
	});
}

const recordCatalogStorageReceipt = catalogReceiptHandler("storage");
const recordCatalogInspectionReceipt = catalogReceiptHandler("inspection");

authComponent.registerRoutes(http, createAuth);
http.route({
	path: CMS_MEDIA_COMPLETION_PATH,
	method: "POST",
	handler: completeCmsMediaDeletion,
});
http.route({
	path: CATALOG_STORAGE_RECEIPT_PATH,
	method: "POST",
	handler: recordCatalogStorageReceipt,
});
http.route({
	path: CATALOG_INSPECTION_RECEIPT_PATH,
	method: "POST",
	handler: recordCatalogInspectionReceipt,
});

export default http;
