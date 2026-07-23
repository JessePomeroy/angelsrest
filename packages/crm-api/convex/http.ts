import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import {
	catalogPrivateEditorPrevalidationHttpStatus,
	catalogPrivateEditorReceiptHttpStatus,
} from "./helpers/catalogPrivateAssetEditorErrors";
import type {
	CatalogPrivateInspectionReceiptSet,
	CatalogPrivateStorageReceiptSet,
} from "./helpers/catalogPrivateAssetReceiptContract";
import {
	CATALOG_PRIVATE_ASSET_RECEIPT_SET_V2_VERSION,
	CATALOG_PRIVATE_ASSET_RECEIPT_SET_VERSION,
} from "./helpers/catalogPrivateAssetReceiptContract";
import {
	validateCatalogPrivateEditorInspectionReceiptSet,
	validateCatalogPrivateEditorStorageReceiptSet,
} from "./helpers/catalogPrivateAssetReceiptValidation";
import {
	CATALOG_EDITOR_PREPARE_ATTESTATION_HEADER,
	CATALOG_EDITOR_SUPPORTED_SITE,
	CATALOG_EDITOR_WORKER_ORIGIN,
	CATALOG_EDITOR_WORKER_PREPARE_PATH,
	catalogEditorCapabilityDigest,
	catalogEditorJournalErrorCategory,
	catalogEditorLeaseDigest,
	catalogEditorRawCapabilityFingerprint,
	catalogEditorUploadHandleHash,
	isCatalogEditorUploadHandle,
	parseCatalogEditorBeginBody,
	parseCatalogEditorWorkerPrepareResponse,
	verifyCatalogEditorPrepareAttestation,
} from "./helpers/catalogPrivateAssetEditorJournal";
import {
	isServerSecretCandidate,
	isTenantSiteSegment,
	purposeScopedServerRoleConfiguration,
	tenantForSecretFixed,
	tenantSecretMatches,
} from "./helpers/serverSecrets";

const http = httpRouter();
const textEncoder = new TextEncoder();

const CMS_MEDIA_COMPLETION_PATH = "/cms-media/complete-deletion";
const MAX_COMPLETION_BODY_BYTES = 4096;
const CATALOG_STORAGE_RECEIPT_PATH = "/cms-media/catalog-private-assets/storage-receipt";
const CATALOG_INSPECTION_RECEIPT_PATH =
	"/cms-media/catalog-private-assets/inspection-receipt";
const MAX_CATALOG_RECEIPT_BODY_BYTES = 256 * 1024;
const CATALOG_EDITOR_STORAGE_RECEIPT_PATH =
	"/cms-media/catalog-private-assets/editor-upload/storage-receipt";
const CATALOG_EDITOR_INSPECTION_RECEIPT_PATH =
	"/cms-media/catalog-private-assets/editor-upload/inspection-receipt";
const MAX_CATALOG_EDITOR_RECEIPT_BODY_BYTES = 32 * 1024;
const MAX_CATALOG_EDITOR_JOURNAL_BODY_BYTES = 16 * 1024;
const CATALOG_EDITOR_JOURNAL_BEGIN_PATH =
	"/cms-media/catalog-private-assets/editor-upload/journal/begin";
const CATALOG_EDITOR_JOURNAL_UPLOAD_PATH =
	"/cms-media/catalog-private-assets/editor-upload/journal/upload-projection";
const CATALOG_EDITOR_JOURNAL_STORAGE_CLAIM_PATH =
	"/cms-media/catalog-private-assets/editor-upload/journal/claim-storage";
const CATALOG_EDITOR_JOURNAL_STORAGE_ACK_PATH =
	"/cms-media/catalog-private-assets/editor-upload/journal/ack-storage";
const CATALOG_EDITOR_JOURNAL_STATUS_PATH =
	"/cms-media/catalog-private-assets/editor-upload/journal/status";
const CATALOG_EDITOR_JOURNAL_INSPECTION_CLAIM_PATH =
	"/cms-media/catalog-private-assets/editor-upload/journal/claim-inspection";
const CATALOG_EDITOR_JOURNAL_INSPECTION_ACK_PATH =
	"/cms-media/catalog-private-assets/editor-upload/journal/ack-inspection";
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

async function readBoundedResponseBytes(response: Response, maximumBytes: number) {
	const contentLengthHeader = response.headers.get("Content-Length");
	if (contentLengthHeader !== null) {
		const contentLength = Number(contentLengthHeader);
		if (
			!Number.isSafeInteger(contentLength)
			|| contentLength < 0
			|| contentLength > maximumBytes
		) return null;
	}
	if (!response.body) return null;
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			byteLength += value.byteLength;
			if (byteLength > maximumBytes) {
				await reader.cancel().catch(() => undefined);
				return null;
			}
			chunks.push(value);
		}
	} catch {
		return null;
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function parseJsonObjectBytes(bytes: Uint8Array) {
	try {
		const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
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
	const roles = purposeScopedServerRoleConfiguration();
	return roles
		&& roles.storageReceipt.size > 0
		&& roles.inspectionReceipt.size > 0
		? { storage: roles.storageReceipt, inspection: roles.inspectionReceipt }
		: null;
}

function catalogEditorJournalRegistries() {
	const roles = purposeScopedServerRoleConfiguration();
	return roles && roles.host.size > 0 && roles.inspector.size > 0 && roles.workerControl.size > 0
		? roles
		: null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
	const keys = Object.keys(value);
	return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function randomLowercase40() {
	const bytes = new Uint8Array(20);
	crypto.getRandomValues(bytes);
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function journalErrorResponse(error: unknown) {
	const category = catalogEditorJournalErrorCategory(error);
	if (category === "validation") return privateResponse("Request could not be processed", 422);
	if (category === "conflict") return privateResponse("Request conflicts with durable state", 409);
	if (category === "gone") return privateResponse("Journal capability is unavailable", 410);
	if (category === "rate_limited") return privateResponse("Work is not currently claimable", 429);
	return privateResponse("Journal service is temporarily unavailable", 503);
}

function journalHandler(
	role: "host" | "inspector",
	path: string,
	handler: (
		ctx: ActionCtx,
		siteUrl: string,
		body: Record<string, unknown>,
	) => Promise<Response>,
) {
	return httpAction(async (ctx, request) => {
		const registries = catalogEditorJournalRegistries();
		if (!registries) return privateResponse("Journal service is temporarily unavailable", 503);
		const siteUrl = await tenantForSecretFixed(registries[role], bearerToken(request));
		if (!siteUrl) return privateResponse("Unauthorized", 401);
		const url = new URL(request.url);
		if (url.pathname !== path || url.search !== "") return privateResponse("Invalid request", 400);
		if (request.headers.get("Content-Type") !== "application/json") {
			return privateResponse("Invalid request", 400);
		}
		const body = await readJsonObject(request, MAX_CATALOG_EDITOR_JOURNAL_BODY_BYTES);
		if (!body) return privateResponse("Invalid request", 400);
		try {
			return await handler(ctx, siteUrl, body);
		} catch (error) {
			return journalErrorResponse(error);
		}
	});
}

type ReceiptSetEnvelope = Record<string, unknown> & {
	schemaVersion:
		| typeof CATALOG_PRIVATE_ASSET_RECEIPT_SET_VERSION
		| typeof CATALOG_PRIVATE_ASSET_RECEIPT_SET_V2_VERSION;
	receiptSetId: string;
	siteUrl: string;
	receipts: unknown[];
};

function isReceiptSetEnvelope(body: Record<string, unknown>): body is ReceiptSetEnvelope {
	return (
		Object.keys(body).length === 4 &&
		(body.schemaVersion === CATALOG_PRIVATE_ASSET_RECEIPT_SET_VERSION ||
			body.schemaVersion === CATALOG_PRIVATE_ASSET_RECEIPT_SET_V2_VERSION) &&
		typeof body.receiptSetId === "string" &&
		isTenantSiteSegment(body.siteUrl) &&
		Array.isArray(body.receipts)
	);
}

function isEditorReceiptSetEnvelope(
	body: Record<string, unknown>,
): body is ReceiptSetEnvelope & { schemaVersion: 2 } {
	return (
		isReceiptSetEnvelope(body) &&
		body.schemaVersion === CATALOG_PRIVATE_ASSET_RECEIPT_SET_V2_VERSION &&
		body.receipts.length === 1
	);
}

async function prevalidateEditorReceipt(
	body: ReceiptSetEnvelope & { schemaVersion: 2 },
	role: "storage" | "inspection",
) {
	if (role === "storage") {
		return {
			role,
			receiptSet: (await validateCatalogPrivateEditorStorageReceiptSet(body)).receiptSet,
		} as const;
	}
	return {
		role,
		receiptSet: (await validateCatalogPrivateEditorInspectionReceiptSet(body)).receiptSet,
	} as const;
}

const completeCmsMediaDeletion = httpAction(async (ctx, request) => {
	const roles = purposeScopedServerRoleConfiguration();
	const registry = roles?.deletion;
	if (!registry || registry.size === 0) {
		return privateResponse("CMS media completion is not configured", 503);
	}
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

function catalogReceiptHandler(
	role: "storage" | "inspection",
	mode: "historical" | "editor_upload" = "historical",
) {
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
		const body = await readJsonObject(
			request,
			mode === "editor_upload"
				? MAX_CATALOG_EDITOR_RECEIPT_BODY_BYTES
				: MAX_CATALOG_RECEIPT_BODY_BYTES,
		);
		if (!body || !isReceiptSetEnvelope(body)) return privateResponse("Invalid request", 400);
		const { siteUrl } = body;
		if (!(await tenantSecretMatches(registries[role], siteUrl, supplied))) {
			return privateResponse("Unauthorized", 401);
		}
		let editorReceipt: Awaited<ReturnType<typeof prevalidateEditorReceipt>> | null = null;
		if (mode === "editor_upload") {
			if (!isEditorReceiptSetEnvelope(body)) return privateResponse("Invalid request", 400);
			try {
				editorReceipt = await prevalidateEditorReceipt(body, role);
			} catch (error) {
				const status = catalogPrivateEditorPrevalidationHttpStatus(error);
				if (status === 503) {
					console.error(
						JSON.stringify({
							event: "cms.catalog_private_receipt_rejected",
							role,
							mode,
							siteUrl,
							code: "receipt_retryable_failure",
						}),
					);
				}
				return privateResponse(
					status === 400
						? "Invalid request"
						: "Private catalog receipt service is temporarily unavailable",
					status,
				);
			}
		}
		try {
			let result;
			if (editorReceipt?.role === "storage") {
				result = await ctx.runMutation(internal.catalogPrivateAssets.recordEditorStorageReceipt, {
					receiptSet: editorReceipt.receiptSet,
				});
			} else if (editorReceipt?.role === "inspection") {
				result = await ctx.runMutation(
					internal.catalogPrivateAssets.recordEditorInspectionReceipt,
					{ receiptSet: editorReceipt.receiptSet },
				);
			} else {
				result =
					role === "storage"
						? await ctx.runMutation(internal.catalogPrivateAssets.recordStorageReceiptSet, {
								receiptSet: body as unknown as CatalogPrivateStorageReceiptSet,
							})
						: await ctx.runMutation(internal.catalogPrivateAssets.recordInspectionReceiptSet, {
								receiptSet: body as unknown as CatalogPrivateInspectionReceiptSet,
							});
			}
			return privateResponse(result, 200);
		} catch (error) {
			const status = mode === "editor_upload" ? catalogPrivateEditorReceiptHttpStatus(error) : 409;
			console.error(
				JSON.stringify({
					event: "cms.catalog_private_receipt_rejected",
					role,
					mode,
					siteUrl,
					code:
						status === 400
							? "receipt_validation"
							: status === 409
								? "receipt_conflict"
								: "receipt_retryable_failure",
				}),
			);
			return privateResponse(
				status === 400
					? "Invalid request"
					: status === 409
						? `Private catalog ${role} receipt could not be accepted`
						: "Private catalog receipt service is temporarily unavailable",
				status,
			);
		}
	});
}

const recordCatalogStorageReceipt = catalogReceiptHandler("storage");
const recordCatalogInspectionReceipt = catalogReceiptHandler("inspection");
const recordCatalogEditorStorageReceipt = catalogReceiptHandler("storage", "editor_upload");
const recordCatalogEditorInspectionReceipt = catalogReceiptHandler("inspection", "editor_upload");

const beginCatalogEditorJournal = journalHandler("host", CATALOG_EDITOR_JOURNAL_BEGIN_PATH, async (ctx, siteUrl, body) => {
	const parsed = parseCatalogEditorBeginBody(body);
	if (!parsed) return privateResponse("Invalid request", 400);
	if (siteUrl !== CATALOG_EDITOR_SUPPORTED_SITE) {
		return privateResponse("Request could not be processed", 422);
	}
	const { uploadHandle, ...descriptor } = parsed;
	const uploadHandleHash = await catalogEditorUploadHandleHash(siteUrl, uploadHandle);
	const reservation = await ctx.runMutation(internal.catalogPrivateAssets.beginEditorJournal, {
		siteUrl,
		uploadHandleHash,
		proposedOperationId: randomLowercase40(),
		descriptor,
	});
	if (reservation.prepareRequired) {
		const roles = purposeScopedServerRoleConfiguration();
		const workerSecret = roles?.workerControl.get(siteUrl)?.[0];
		if (!workerSecret) throw new Error("Worker control role is unavailable");
		// Convex owns this request/response channel. The host sees neither the
		// Worker control credential nor either server-only continuation.
		const workerRequestBytes = textEncoder.encode(JSON.stringify(reservation.workerPrepare));
		const workerResponse = await fetch(
			new URL(CATALOG_EDITOR_WORKER_PREPARE_PATH, CATALOG_EDITOR_WORKER_ORIGIN),
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${workerSecret}`,
					"Content-Type": "application/json",
				},
				body: workerRequestBytes,
			},
		);
		if (
			!workerResponse.ok
			|| workerResponse.headers.get("Content-Type") !== "application/json"
		) throw new Error("Worker prepare failed");
		const workerResponseBytes = await readBoundedResponseBytes(
			workerResponse,
			MAX_CATALOG_EDITOR_JOURNAL_BODY_BYTES,
		);
		if (
			!workerResponseBytes
			|| !await verifyCatalogEditorPrepareAttestation(
				workerResponse.headers.get(CATALOG_EDITOR_PREPARE_ATTESTATION_HEADER),
				workerSecret,
				workerRequestBytes,
				workerResponseBytes,
			)
		) throw new Error("Worker prepare response was not attested");
		const rawPrepared = parseJsonObjectBytes(workerResponseBytes);
		const prepared = rawPrepared
			? parseCatalogEditorWorkerPrepareResponse(rawPrepared, Date.now(), {
					siteUrl,
					operationId: reservation.workerPrepare.operationId,
					declarationHash: reservation.declarationHash,
				})
			: null;
		if (!prepared) throw new Error("Worker prepare response was invalid");
		const [
			uploadDigest,
			storageDigest,
			inspectionDigest,
			uploadRawFingerprint,
			storageRawFingerprint,
			inspectionRawFingerprint,
		] = await Promise.all([
			catalogEditorCapabilityDigest("upload", prepared.uploadToken),
			catalogEditorCapabilityDigest("storage", prepared.storageContinuation),
			catalogEditorCapabilityDigest("inspection", prepared.inspectionContinuation),
			catalogEditorRawCapabilityFingerprint(prepared.uploadToken),
			catalogEditorRawCapabilityFingerprint(prepared.storageContinuation),
			catalogEditorRawCapabilityFingerprint(prepared.inspectionContinuation),
		]);
		try {
			await ctx.runMutation(internal.catalogPrivateAssets.commitEditorPrepare, {
				siteUrl: prepared.binding.siteUrl,
				uploadHandleHash,
				operationId: prepared.binding.operationId,
				declarationHash: prepared.binding.declarationHash,
				generation: 1,
				upload: {
					value: prepared.uploadToken,
					digest: uploadDigest,
					rawFingerprint: uploadRawFingerprint,
					issuedAt: prepared.issuedAt,
					expiresAt: prepared.uploadExpiresAt,
				},
				storage: {
					value: prepared.storageContinuation,
					digest: storageDigest,
					rawFingerprint: storageRawFingerprint,
					issuedAt: prepared.issuedAt,
					expiresAt: prepared.storageExpiresAt,
				},
				inspection: {
					value: prepared.inspectionContinuation,
					digest: inspectionDigest,
					rawFingerprint: inspectionRawFingerprint,
					issuedAt: prepared.issuedAt,
					expiresAt: prepared.inspectionExpiresAt,
				},
			});
		} catch (error) {
			// Concurrent lost-response retries may both complete /prepare. Only the
			// first generation commits; a later response is discarded if that exact
			// operation already has a usable upload projection.
			if (catalogEditorJournalErrorCategory(error) !== "conflict") throw error;
			await ctx.runQuery(internal.catalogPrivateAssets.getEditorUploadProjection, {
				siteUrl,
				uploadHandleHash,
			});
		}
	}
	const upload = await ctx.runQuery(internal.catalogPrivateAssets.getEditorUploadProjection, {
		siteUrl,
		uploadHandleHash,
	});
	return privateResponse({
		replayed: reservation.replayed,
		operationId: reservation.workerPrepare.operationId,
		...upload,
	}, 200);
});

const getCatalogEditorUploadProjection = journalHandler("host", CATALOG_EDITOR_JOURNAL_UPLOAD_PATH, async (ctx, siteUrl, body) => {
	if (!exactKeys(body, ["uploadHandle"]) || !isCatalogEditorUploadHandle(body.uploadHandle)) {
		return privateResponse("Invalid request", 400);
	}
	const uploadHandleHash = await catalogEditorUploadHandleHash(siteUrl, body.uploadHandle);
	const result = await ctx.runQuery(internal.catalogPrivateAssets.getEditorUploadProjection, {
		siteUrl,
		uploadHandleHash,
	});
	return privateResponse(result, 200);
});

const claimCatalogEditorStorage = journalHandler("host", CATALOG_EDITOR_JOURNAL_STORAGE_CLAIM_PATH, async (ctx, siteUrl, body) => {
	if (!exactKeys(body, ["uploadHandle"]) || !isCatalogEditorUploadHandle(body.uploadHandle)) {
		return privateResponse("Invalid request", 400);
	}
	const lease = randomLowercase40();
	const [uploadHandleHash, leaseDigest] = await Promise.all([
		catalogEditorUploadHandleHash(siteUrl, body.uploadHandle),
		catalogEditorLeaseDigest("storage", lease),
	]);
	const result = await ctx.runMutation(internal.catalogPrivateAssets.claimEditorStorage, {
		siteUrl,
		uploadHandleHash,
		leaseDigest,
	});
	return privateResponse("storageContinuation" in result ? { ...result, lease } : result, 200);
});

const ackCatalogEditorStorage = journalHandler("host", CATALOG_EDITOR_JOURNAL_STORAGE_ACK_PATH, async (ctx, siteUrl, body) => {
	if (
		!exactKeys(body, ["uploadHandle", "lease", "outcome"])
		|| !isCatalogEditorUploadHandle(body.uploadHandle)
		|| typeof body.lease !== "string"
		|| !/^[0-9a-f]{40}$/.test(body.lease)
		|| (body.outcome !== "success" && body.outcome !== "retryable" && body.outcome !== "rejected")
	) return privateResponse("Invalid request", 400);
	const [uploadHandleHash, leaseDigest] = await Promise.all([
		catalogEditorUploadHandleHash(siteUrl, body.uploadHandle),
		catalogEditorLeaseDigest("storage", body.lease),
	]);
	const result = await ctx.runMutation(internal.catalogPrivateAssets.ackEditorStorage, {
		siteUrl,
		uploadHandleHash,
		leaseDigest,
		outcome: body.outcome,
	});
	return privateResponse(result, 200);
});

const getCatalogEditorJournalStatus = journalHandler("host", CATALOG_EDITOR_JOURNAL_STATUS_PATH, async (ctx, siteUrl, body) => {
	if (!exactKeys(body, ["uploadHandle"]) || !isCatalogEditorUploadHandle(body.uploadHandle)) {
		return privateResponse("Invalid request", 400);
	}
	const uploadHandleHash = await catalogEditorUploadHandleHash(siteUrl, body.uploadHandle);
	const result = await ctx.runQuery(internal.catalogPrivateAssets.getEditorJournalStatus, {
		siteUrl,
		uploadHandleHash,
	});
	return privateResponse(result, 200);
});

const claimCatalogEditorInspection = journalHandler("inspector", CATALOG_EDITOR_JOURNAL_INSPECTION_CLAIM_PATH, async (ctx, siteUrl, body) => {
	if (!exactKeys(body, [])) return privateResponse("Invalid request", 400);
	const lease = randomLowercase40();
	const leaseDigest = await catalogEditorLeaseDigest("inspection_dispatch", lease);
	const result = await ctx.runMutation(internal.catalogPrivateAssets.claimEditorInspection, {
		siteUrl,
		leaseDigest,
	});
	return privateResponse("inspectionContinuation" in result ? { ...result, lease } : result, 200);
});

const ackCatalogEditorInspection = journalHandler("inspector", CATALOG_EDITOR_JOURNAL_INSPECTION_ACK_PATH, async (ctx, siteUrl, body) => {
	if (
		!exactKeys(body, ["claimId", "lease", "outcome"])
		|| typeof body.claimId !== "string"
		|| body.claimId.length === 0
		|| body.claimId.length > 128
		|| typeof body.lease !== "string"
		|| !/^[0-9a-f]{40}$/.test(body.lease)
		|| (body.outcome !== "success" && body.outcome !== "retryable" && body.outcome !== "rejected")
	) return privateResponse("Invalid request", 400);
	const leaseDigest = await catalogEditorLeaseDigest("inspection_dispatch", body.lease);
	const result = await ctx.runMutation(internal.catalogPrivateAssets.ackEditorInspection, {
		siteUrl,
		claimId: body.claimId,
		leaseDigest,
		outcome: body.outcome,
	});
	return privateResponse(result, 200);
});

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

http.route({
	path: CATALOG_EDITOR_STORAGE_RECEIPT_PATH,
	method: "POST",
	handler: recordCatalogEditorStorageReceipt,
});
http.route({
	path: CATALOG_EDITOR_INSPECTION_RECEIPT_PATH,
	method: "POST",
	handler: recordCatalogEditorInspectionReceipt,
});
http.route({
	path: CATALOG_EDITOR_JOURNAL_BEGIN_PATH,
	method: "POST",
	handler: beginCatalogEditorJournal,
});
http.route({
	path: CATALOG_EDITOR_JOURNAL_UPLOAD_PATH,
	method: "POST",
	handler: getCatalogEditorUploadProjection,
});
http.route({
	path: CATALOG_EDITOR_JOURNAL_STORAGE_CLAIM_PATH,
	method: "POST",
	handler: claimCatalogEditorStorage,
});
http.route({
	path: CATALOG_EDITOR_JOURNAL_STORAGE_ACK_PATH,
	method: "POST",
	handler: ackCatalogEditorStorage,
});
http.route({
	path: CATALOG_EDITOR_JOURNAL_STATUS_PATH,
	method: "POST",
	handler: getCatalogEditorJournalStatus,
});
http.route({
	path: CATALOG_EDITOR_JOURNAL_INSPECTION_CLAIM_PATH,
	method: "POST",
	handler: claimCatalogEditorInspection,
});
http.route({
	path: CATALOG_EDITOR_JOURNAL_INSPECTION_ACK_PATH,
	method: "POST",
	handler: ackCatalogEditorInspection,
});

export default http;
