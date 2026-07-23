/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	editorInspectionSetV2,
	editorPrintFacts,
	editorStorageSetV2,
	EDITOR_INSPECTION_PATH,
	EDITOR_STORAGE_PATH,
	postReceipt,
} from "../test/catalogPrivateAssetReceiptFixtures";
import { api, internal } from "./_generated/api";
import {
	CATALOG_EDITOR_CLAIM_EXPIRY_SKEW_MS,
	CATALOG_EDITOR_INSPECTION_LEASE_MS,
	CATALOG_EDITOR_PREPARE_ATTESTATION_DOMAIN,
	CATALOG_EDITOR_PREPARE_ATTESTATION_HEADER,
	CATALOG_EDITOR_STORAGE_LEASE_MS,
	catalogEditorCapabilityDigest,
	catalogEditorRawCapabilityFingerprint,
	verifyCatalogEditorPrepareAttestation,
} from "./helpers/catalogPrivateAssetEditorJournal";
import { createCatalogPrivateAssetReceiptSetId } from "./helpers/catalogPrivateAssetReceiptValidation";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SITE = "angelsrest.online";
const OTHER_SITE = "site-b.example";
const ADMIN_EMAIL = "admin@angelsrest.online";
const HOST_SECRET = "catalog-editor-host-journal-a-0123456789abcdef";
const HOST_SECRET_PREVIOUS = "catalog-editor-host-journal-previous-0123456789";
const OTHER_HOST_SECRET = "catalog-editor-host-journal-b-0123456789abcdef";
const INSPECTOR_SECRET = "catalog-editor-inspector-claim-a-0123456789abcdef";
const OTHER_INSPECTOR_SECRET = "catalog-editor-inspector-claim-b-0123456789abcdef";
const WORKER_CONTROL_SECRET = "catalog-editor-worker-control-a-0123456789abcdef";
const STORAGE_SECRET = "catalog-storage-secret-a-0123456789abcdef";
const INSPECTION_RECEIPT_SECRET = "catalog-inspection-secret-a-0123456789abcdef";
const DELETION_SECRET = "catalog-deletion-secret-a-0123456789abcdef";
const BETTER_AUTH_SECRET = "test-better-auth-secret-0123456789";
const AUTH_GOOGLE_SECRET = "catalog-google-oauth-secret-0123456789abcdef";
const STRIPE_SECRET_KEY = "sk_test_catalog-stripe-authority-0123456789abcdef";
const WEBHOOK_SECRET = "catalog-broad-webhook-secret-0123456789abcdef";
const ORDER_LOOKUP_SECRET = "catalog-order-lookup-secret-0123456789abcdef";
const BEGIN_PATH = "/cms-media/catalog-private-assets/editor-upload/journal/begin";
const RETIRED_COMMIT_PATH =
	"/cms-media/catalog-private-assets/editor-upload/journal/commit-prepare";
const UPLOAD_PATH = "/cms-media/catalog-private-assets/editor-upload/journal/upload-projection";
const STORAGE_CLAIM_PATH = "/cms-media/catalog-private-assets/editor-upload/journal/claim-storage";
const STORAGE_ACK_PATH = "/cms-media/catalog-private-assets/editor-upload/journal/ack-storage";
const STATUS_PATH = "/cms-media/catalog-private-assets/editor-upload/journal/status";
const INSPECTION_CLAIM_PATH =
	"/cms-media/catalog-private-assets/editor-upload/journal/claim-inspection";
const INSPECTION_ACK_PATH =
	"/cms-media/catalog-private-assets/editor-upload/journal/ack-inspection";
const DELETION_PATH = "/cms-media/complete-deletion";
const HANDLE_A = "12345678-1234-4123-8123-123456789abc";
const HANDLE_B = "22345678-1234-4123-8123-123456789abc";
const envNames = [
	"SITE_URL",
	"BETTER_AUTH_SECRET",
	"AUTH_GOOGLE_SECRET",
	"STRIPE_SECRET_KEY",
	"WEBHOOK_SECRET",
	"ORDER_LOOKUP_SECRET",
	"CATALOG_PRIVATE_ASSET_EDITOR_HOST_JOURNAL_SECRETS",
	"CATALOG_PRIVATE_ASSET_EDITOR_INSPECTION_CLAIM_SECRETS",
	"CATALOG_PRIVATE_EDITOR_UPLOAD_CONTROL_SECRETS",
	"CATALOG_PRIVATE_ASSET_STORAGE_RECEIPT_SECRETS",
	"CATALOG_PRIVATE_ASSET_INSPECTION_RECEIPT_SECRETS",
	"CMS_MEDIA_DELETION_COMPLETION_SECRETS",
] as const;
const previousEnv = new Map<string, string | undefined>();
const workerResponses = new Map<string, ReturnType<typeof workerResponse>>();
let reuseFirstWorkerResponse = false;
let resignFirstWorkerResponse = false;
let firstWorkerExchange:
	| { requestBytes: Uint8Array<ArrayBuffer>; response: ReturnType<typeof workerResponse> }
	| undefined;
let workerAttestationMode:
	| "valid"
	| "absent"
	| "malformed"
	| "wrong_request"
	| "wrong_response"
	| "wrong_key"
	| "wrong_domain" = "valid";
let workerCallCount = 0;

beforeEach(() => {
	for (const name of envNames) previousEnv.set(name, process.env[name]);
	process.env.SITE_URL = `https://${SITE}`;
	process.env.BETTER_AUTH_SECRET = BETTER_AUTH_SECRET;
	process.env.AUTH_GOOGLE_SECRET = AUTH_GOOGLE_SECRET;
	process.env.STRIPE_SECRET_KEY = STRIPE_SECRET_KEY;
	process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
	process.env.ORDER_LOOKUP_SECRET = ORDER_LOOKUP_SECRET;
	process.env.CATALOG_PRIVATE_ASSET_EDITOR_HOST_JOURNAL_SECRETS = JSON.stringify({
		[SITE]: [HOST_SECRET, HOST_SECRET_PREVIOUS],
		[OTHER_SITE]: [OTHER_HOST_SECRET],
	});
	process.env.CATALOG_PRIVATE_ASSET_EDITOR_INSPECTION_CLAIM_SECRETS = JSON.stringify({
		[SITE]: [INSPECTOR_SECRET],
		[OTHER_SITE]: [OTHER_INSPECTOR_SECRET],
	});
	process.env.CATALOG_PRIVATE_EDITOR_UPLOAD_CONTROL_SECRETS = JSON.stringify({
		[SITE]: [WORKER_CONTROL_SECRET],
	});
	process.env.CATALOG_PRIVATE_ASSET_STORAGE_RECEIPT_SECRETS = JSON.stringify({
		[SITE]: [STORAGE_SECRET],
	});
	process.env.CATALOG_PRIVATE_ASSET_INSPECTION_RECEIPT_SECRETS = JSON.stringify({
		[SITE]: [INSPECTION_RECEIPT_SECRET],
	});
	process.env.CMS_MEDIA_DELETION_COMPLETION_SECRETS = JSON.stringify({
		[SITE]: [DELETION_SECRET],
	});
	workerResponses.clear();
	reuseFirstWorkerResponse = false;
	resignFirstWorkerResponse = false;
	firstWorkerExchange = undefined;
	workerAttestationMode = "valid";
	workerCallCount = 0;
	vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
		workerCallCount += 1;
		expect(init?.headers).toMatchObject({
			Authorization: `Bearer ${WORKER_CONTROL_SECRET}`,
			"Content-Type": "application/json",
		});
		const requestBytes = requestBodyBytes(init?.body);
		const declaration = JSON.parse(new TextDecoder().decode(requestBytes)) as {
			operationId: string;
			siteUrl: string;
		};
		expect(declaration.siteUrl).toBe(SITE);
		if ((reuseFirstWorkerResponse || resignFirstWorkerResponse) && firstWorkerExchange) {
			return await signedWorkerResponse(
				firstWorkerExchange.response,
				resignFirstWorkerResponse ? requestBytes : firstWorkerExchange.requestBytes,
			);
		}
		let response = workerResponses.get(declaration.operationId);
		if (!response) {
			response = workerResponse(workerResponses.size);
			workerResponses.set(declaration.operationId, response);
		}
		firstWorkerExchange ??= { requestBytes: requestBytes.slice(), response };
		return await signedWorkerResponse(response, requestBytes, workerAttestationMode);
	}));
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	for (const name of envNames) {
		const value = previousEnv.get(name);
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	previousEnv.clear();
});

async function seedClients(t: ReturnType<typeof convexTest>) {
	for (const siteUrl of [SITE, OTHER_SITE]) {
		await t.mutation(internal.platform.seedClient, {
			name: siteUrl,
			email: siteUrl === SITE ? ADMIN_EMAIL : `${siteUrl}@example.com`,
			siteUrl,
			tier: "full",
			subscriptionStatus: "active",
			adminEmails: [siteUrl === SITE ? ADMIN_EMAIL : `${siteUrl}@example.com`],
			role: "client",
			catalogProductKinds: ["print", "print_set", "digital_download"],
		});
	}
}

function printBegin(uploadHandle = HANDLE_A, productKind: "print" | "print_set" = "print") {
	return {
		uploadHandle,
		productKind,
		originalFilename: "journal-source.jpg",
		contentType: "image/jpeg",
		sizeBytes: 8_000_000,
		sha256: "c".repeat(64),
		widthPixels: 6000,
		heightPixels: 4000,
	};
}

function digitalBegin(uploadHandle = HANDLE_B) {
	return {
		uploadHandle,
		productKind: "digital_download",
		originalFilename: "paid-files.zip",
		contentType: "application/zip",
		sizeBytes: 16_777_216,
		sha256: "d".repeat(64),
		version: "2026.1",
	};
}

function token(character: string) {
	return `cms-editor-upload-v1.${character.repeat(2768)}`;
}

function requestBodyBytes(body: BodyInit | null | undefined): Uint8Array<ArrayBuffer> {
	if (body instanceof Uint8Array) return new Uint8Array(body);
	if (body instanceof ArrayBuffer) return new Uint8Array(body);
	if (typeof body === "string") return new TextEncoder().encode(body);
	throw new Error("expected exact Worker request bytes");
}

async function workerAttestation(
	secret: string,
	requestBytes: Uint8Array<ArrayBuffer>,
	responseBytes: Uint8Array<ArrayBuffer>,
	domain = CATALOG_EDITOR_PREPARE_ATTESTATION_DOMAIN,
) {
	const encoder = new TextEncoder();
	const [requestHash, responseHash, key] = await Promise.all([
		crypto.subtle.digest("SHA-256", requestBytes),
		crypto.subtle.digest("SHA-256", responseBytes),
		crypto.subtle.importKey(
			"raw",
			encoder.encode(secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		),
	]);
	const domainBytes = encoder.encode(domain);
	const input = new Uint8Array(domainBytes.byteLength + 64);
	input.set(domainBytes);
	input.set(new Uint8Array(requestHash), domainBytes.byteLength);
	input.set(new Uint8Array(responseHash), domainBytes.byteLength + 32);
	const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, input));
	return `v1.${[...mac].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function signedWorkerResponse(
	body: ReturnType<typeof workerResponse>,
	requestBytes: Uint8Array<ArrayBuffer>,
	mode: typeof workerAttestationMode = "valid",
) {
	let responseBytes = new TextEncoder().encode(JSON.stringify(body));
	const signingRequest = mode === "wrong_request"
		? new Uint8Array([...requestBytes, 0x20])
		: requestBytes;
	const signingSecret = mode === "wrong_key" ? `${WORKER_CONTROL_SECRET}-wrong` : WORKER_CONTROL_SECRET;
	const domain = mode === "wrong_domain"
		? `${CATALOG_EDITOR_PREPARE_ATTESTATION_DOMAIN}wrong`
		: CATALOG_EDITOR_PREPARE_ATTESTATION_DOMAIN;
	let attestation = await workerAttestation(signingSecret, signingRequest, responseBytes, domain);
	if (mode === "wrong_response") responseBytes = new Uint8Array([...responseBytes, 0x20]);
	if (mode === "malformed") attestation = attestation.toUpperCase();
	const headers = new Headers({ "Content-Type": "application/json" });
	if (mode !== "absent") headers.set(CATALOG_EDITOR_PREPARE_ATTESTATION_HEADER, attestation);
	return new Response(responseBytes, { headers });
}

function workerResponse(index = 0, now = Date.now()) {
	const characters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";
	const offset = (index * 3) % (characters.length - 2);
	return {
		status: "upload_required",
		uploadPath: "/v1/catalog-assets/editor-uploads/source",
		uploadToken: token(characters[offset]!),
		uploadExpiresAt: new Date(now + 15 * 60 * 1000).toISOString(),
		serverOnly: {
			custody: "server_only",
			purpose: "future_storage_completion",
			storageContinuation: token(characters[offset + 1]!),
			storageExpiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
			inspectionContinuation: token(characters[offset + 2]!),
			inspectionExpiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
		},
	};
}

async function post(
	t: ReturnType<typeof convexTest>,
	path: string,
	secret: string,
	body: unknown,
) {
	return await t.fetch(path, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${secret}`,
			"Content-Type": "application/json",
		},
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

async function begin(t: ReturnType<typeof convexTest>, handle = HANDLE_A) {
	const response = await post(t, BEGIN_PATH, HOST_SECRET, printBegin(handle));
	expect(response.status).toBe(200);
	return await response.json() as {
		operationId: string;
		replayed: boolean;
		uploadToken: string;
		uploadExpiresAt: string;
	};
}

async function receiptsFor(operationId: string) {
	const facts = editorPrintFacts(SITE, operationId);
	facts.originalFilename = "journal-source.jpg";
	const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE, [facts], 2);
	return {
		facts,
		storage: editorStorageSetV2(receiptSetId, facts),
		inspection: editorInspectionSetV2(receiptSetId, facts),
	};
}

async function journalState(t: ReturnType<typeof convexTest>) {
	return await t.run(async (ctx) => ({
		operations: await ctx.db.query("catalogPrivateAssetEditorOperations").take(50),
		capabilities: await ctx.db.query("catalogPrivateAssetEditorCapabilities").take(100),
		effects: await ctx.db.query("catalogPrivateAssetEditorEffects").take(100),
	}));
}

type InspectionJobSeed = {
	siteUrl: string;
	key: string;
	state?: "queued" | "leased";
	attempts?: number;
	generation?: number;
	operationGeneration?: number;
	operationLifecycle?: "storage_recorded" | "verified";
	capabilityGeneration?: number;
	capabilityExpiresAt?: number;
	leaseExpiresAt?: number;
	omitLeaseExpiresAt?: boolean;
};

async function seedInspectionJob(
	t: ReturnType<typeof convexTest>,
	seed: InspectionJobSeed,
) {
	const now = Date.now();
	const generation = seed.generation ?? 1;
	const state = seed.state ?? "queued";
	const operationId = seed.key.repeat(40);
	return await t.run(async (ctx) => {
		const operationIdRow = await ctx.db.insert("catalogPrivateAssetEditorOperations", {
			siteUrl: seed.siteUrl,
			operationId,
			sourceId: `source-${seed.key}`,
			kind: "print_source",
			assetKey: `asset-${seed.key}`,
			privateObjectKey: `private/${seed.key}`,
			createdAt: now,
			journalVersion: 1,
			lifecycle: seed.operationLifecycle ?? "storage_recorded",
			generation: seed.operationGeneration ?? generation,
			updatedAt: now,
		});
		const capabilityId = await ctx.db.insert("catalogPrivateAssetEditorCapabilities", {
			siteUrl: seed.siteUrl,
			operationId,
			purpose: "inspection",
			value: token(seed.key),
			digest: seed.key.repeat(64),
			issuedAt: now,
			expiresAt: seed.capabilityExpiresAt ?? now + 60 * 60 * 1000,
			purgeAt: now + 2 * 60 * 60 * 1000,
			generation: seed.capabilityGeneration ?? generation,
			createdAt: now,
			updatedAt: now,
		});
		const leaseExpiresAt = seed.omitLeaseExpiresAt
			? undefined
			: seed.leaseExpiresAt ?? now - 1;
		const effectId = await ctx.db.insert("catalogPrivateAssetEditorEffects", {
			siteUrl: seed.siteUrl,
			operationId,
			kind: "inspection_dispatch",
			generation,
			state,
			attempts: seed.attempts ?? 0,
			nextAttemptAt: state === "leased" ? leaseExpiresAt ?? now : now,
			...(state === "leased"
				? {
					leaseDigest: seed.key.repeat(64),
					...(leaseExpiresAt === undefined ? {} : { leaseExpiresAt }),
				}
				: {}),
			createdAt: now,
			updatedAt: now,
		});
		return { operationIdRow, capabilityId, effectId, operationId };
	});
}

describe("Gallery Worker prepare attestation locked vectors", () => {
	test("copies the merged v1 request-hash then response-hash contract independently", async () => {
		const encoder = new TextEncoder();
		const requestBytes = encoder.encode('{"operationId":"0123456789abcdef"}\n');
		const responseBytes = encoder.encode('{"status":"upload_required"}');
		const controlSecret = "control-current-0123456789abcdef";
		const attestation = await workerAttestation(controlSecret, requestBytes, responseBytes);

		expect(CATALOG_EDITOR_PREPARE_ATTESTATION_DOMAIN).toBe(
			"cms-media-worker\0production\0editor-upload-prepare-attestation\0v1\0",
		);
		expect(attestation).toBe(
			"v1.01e517ff02e8bc34df683bf650ea8cd5dcc08ffe04aed864134601ecd57678e3",
		);
		expect(await verifyCatalogEditorPrepareAttestation(
			attestation,
			controlSecret,
			requestBytes,
			responseBytes,
		)).toBe(true);

		for (const candidate of [
			await workerAttestation(controlSecret, responseBytes, requestBytes),
			await workerAttestation(
				controlSecret,
				requestBytes,
				responseBytes,
				`${CATALOG_EDITOR_PREPARE_ATTESTATION_DOMAIN}wrong`,
			),
			attestation.toUpperCase(),
			"v2.01e517ff02e8bc34df683bf650ea8cd5dcc08ffe04aed864134601ecd57678e3",
			"v1.not-hex",
		] as const) {
			expect(await verifyCatalogEditorPrepareAttestation(
				candidate,
				controlSecret,
				requestBytes,
				responseBytes,
			)).toBe(false);
		}
		expect(await verifyCatalogEditorPrepareAttestation(
			attestation,
			`${controlSecret}-wrong`,
			requestBytes,
			responseBytes,
		)).toBe(false);
		expect(await verifyCatalogEditorPrepareAttestation(
			attestation,
			controlSecret,
			requestBytes,
			new Uint8Array([...responseBytes, 0x20]),
		)).toBe(false);
		expect(await verifyCatalogEditorPrepareAttestation(
			null,
			controlSecret,
			requestBytes,
			responseBytes,
		)).toBe(false);
	});
});

describe("catalog editor durable journal HTTP roles", () => {
	test("runs Worker prepare inside the journal boundary and admits only the supported tenant", async () => {
		const t = convexTest(schema, modules);
		await seedClients(t);
		const response = await post(t, BEGIN_PATH, HOST_SECRET, printBegin());
		expect(response.status).toBe(200);
		expect(response.headers.get(CATALOG_EDITOR_PREPARE_ATTESTATION_HEADER)).toBeNull();
		const text = await response.text();
		expect(text).not.toMatch(/Continuation|serverOnly|workerPrepare|cms-editor-upload-v1\.[bc]/);
		expect(JSON.parse(text)).toMatchObject({
			uploadPath: "/v1/catalog-assets/editor-uploads/source",
			uploadToken: token("a"),
		});
		expect(workerCallCount).toBe(1);
		expect((await post(t, RETIRED_COMMIT_PATH, HOST_SECRET, {
			uploadHandle: HANDLE_A,
			workerResponse: workerResponse(),
		})).status).toBe(404);
		expect((await post(t, BEGIN_PATH, OTHER_HOST_SECRET, printBegin(HANDLE_B))).status).toBe(422);
		expect((await journalState(t)).operations.map(({ siteUrl }) => siteUrl)).toEqual([SITE]);
	});

	test("rejects every absent or mismatched Worker byte attestation before commit", async () => {
		for (const mode of [
			"absent",
			"malformed",
			"wrong_request",
			"wrong_response",
			"wrong_key",
			"wrong_domain",
		] as const) {
			const t = convexTest(schema, modules);
			await seedClients(t);
			workerAttestationMode = mode;
			const response = await post(t, BEGIN_PATH, HOST_SECRET, printBegin());
			expect(response.status, mode).toBe(503);
			expect(response.headers.get(CATALOG_EDITOR_PREPARE_ATTESTATION_HEADER)).toBeNull();
			expect((await journalState(t)).capabilities, mode).toEqual([]);
			workerResponses.clear();
			firstWorkerExchange = undefined;
		}
	});

	test("fails the authority endpoint cross-matrix closed for every configured overlap", async () => {
		for (const envName of [
			"BETTER_AUTH_SECRET",
			"AUTH_GOOGLE_SECRET",
			"STRIPE_SECRET_KEY",
			"WEBHOOK_SECRET",
			"ORDER_LOOKUP_SECRET",
		] as const) {
			const t = convexTest(schema, modules);
			await seedClients(t);
			const original = process.env[envName];
			process.env[envName] = HOST_SECRET_PREVIOUS;
			expect((await post(t, BEGIN_PATH, HOST_SECRET, printBegin())).status, envName).toBe(503);
			expect((await post(t, EDITOR_STORAGE_PATH, STORAGE_SECRET, {})).status, envName).toBe(503);
			expect((await post(t, DELETION_PATH, DELETION_SECRET, {})).status, envName).toBe(503);
			expect((await t.fetch("/api/auth/get-session")).status, envName).toBe(403);
			await expect(t.mutation(api.inquiries.create, {
				webhookSecret: process.env.WEBHOOK_SECRET!,
				siteUrl: SITE,
				name: "Overlap",
				email: "overlap@example.com",
				message: "must fail closed",
			})).rejects.toThrow(/overlap/i);
			await expect(t.query(api.orders.lookupForCustomer, {
				siteUrl: SITE,
				email: "customer@example.com",
				orderNumber: "AR-0001",
				lookupSecret: process.env.ORDER_LOOKUP_SECRET!,
			})).rejects.toThrow(/overlap/i);
			process.env[envName] = original;
		}

		for (const envName of [
			"CATALOG_PRIVATE_ASSET_EDITOR_HOST_JOURNAL_SECRETS",
			"CATALOG_PRIVATE_ASSET_EDITOR_INSPECTION_CLAIM_SECRETS",
			"CATALOG_PRIVATE_EDITOR_UPLOAD_CONTROL_SECRETS",
			"CATALOG_PRIVATE_ASSET_STORAGE_RECEIPT_SECRETS",
			"CATALOG_PRIVATE_ASSET_INSPECTION_RECEIPT_SECRETS",
			"CMS_MEDIA_DELETION_COMPLETION_SECRETS",
		] as const) {
			const t = convexTest(schema, modules);
			await seedClients(t);
			const original = process.env[envName];
			process.env[envName] = envName === "CATALOG_PRIVATE_ASSET_EDITOR_HOST_JOURNAL_SECRETS"
				? JSON.stringify({
					[SITE]: [HOST_SECRET, HOST_SECRET_PREVIOUS],
					[OTHER_SITE]: [HOST_SECRET_PREVIOUS],
				})
				: JSON.stringify({ [SITE]: [HOST_SECRET_PREVIOUS] });
			expect((await post(t, BEGIN_PATH, HOST_SECRET, printBegin())).status, envName).toBe(503);
			expect((await post(t, EDITOR_STORAGE_PATH, STORAGE_SECRET, {})).status, envName).toBe(503);
			expect((await post(t, DELETION_PATH, DELETION_SECRET, {})).status, envName).toBe(503);
			expect((await t.fetch("/api/auth/get-session")).status, envName).toBe(403);
			await expect(t.mutation(api.inquiries.create, {
				webhookSecret: WEBHOOK_SECRET,
				siteUrl: SITE,
				name: "Overlap",
				email: "overlap@example.com",
				message: "must fail closed",
			})).rejects.toThrow(/overlap/i);
			await expect(t.query(api.orders.lookupForCustomer, {
				siteUrl: SITE,
				email: "customer@example.com",
				orderNumber: "AR-0001",
				lookupSecret: ORDER_LOOKUP_SECRET,
			})).rejects.toThrow(/overlap/i);
			process.env[envName] = original;
		}
	});

	test("bounds malformed requests and enforces print and digital Worker policy boundaries", async () => {
		const t = convexTest(schema, modules);
		await seedClients(t);
		for (const body of [
			null,
			[],
			{ ...printBegin(), nested: {} },
			{ ...printBegin(), widthPixels: 100_001 },
			{ ...printBegin(), sha256: "C".repeat(64) },
			{ ...digitalBegin(), sizeBytes: 16_777_217 },
			{ ...digitalBegin(), originalFilename: "paid-files.tar" },
		]) {
			const response = await post(t, BEGIN_PATH, HOST_SECRET, body);
			expect(response.status).toBe(400);
			expect(await response.text()).not.toContain("sha256");
		}
		const digital = await post(t, BEGIN_PATH, HOST_SECRET, digitalBegin());
		expect(digital.status).toBe(200);
		const declaration = JSON.parse(new TextDecoder().decode(requestBodyBytes(
			(vi.mocked(globalThis.fetch).mock.calls.at(-1)?.[1] as RequestInit | undefined)?.body,
		)));
		expect(declaration).toMatchObject({
			siteUrl: SITE,
			kind: "paid_digital_file",
			contentType: "application/zip",
			sizeBytes: 16_777_216,
		});
	});

	test("keeps concurrent and lost-response begin idempotent and rejects cross-operation capabilities", async () => {
		const t = convexTest(schema, modules);
		await seedClients(t);
		const responses = await Promise.all([
			post(t, BEGIN_PATH, HOST_SECRET, printBegin()),
			post(t, BEGIN_PATH, HOST_SECRET, printBegin()),
		]);
		expect(responses.map(({ status }) => status)).toEqual([200, 200]);
		const bodies = await Promise.all(responses.map(async (response) => await response.json())) as Array<{
			operationId: string;
		}>;
		expect(new Set(bodies.map(({ operationId }) => operationId)).size).toBe(1);
		const replay = await post(t, BEGIN_PATH, HOST_SECRET, printBegin());
		expect(replay.status).toBe(200);
		expect((await replay.json() as { replayed: boolean }).replayed).toBe(true);
		expect((await post(t, BEGIN_PATH, HOST_SECRET, {
			...printBegin(),
			sha256: "f".repeat(64),
		})).status).toBe(409);
		const beforeSwap = await journalState(t);
		reuseFirstWorkerResponse = true;
		const swapped = await post(t, BEGIN_PATH, HOST_SECRET, printBegin(HANDLE_B));
		expect(swapped.status).toBe(503);
		const afterSwap = await journalState(t);
		expect(afterSwap.operations).toHaveLength(2);
		expect(afterSwap.capabilities).toHaveLength(beforeSwap.capabilities.length);
		expect(afterSwap.capabilities.every(({ operationId }) => operationId === bodies[0]?.operationId))
			.toBe(true);
	});

	test("enforces one purpose-independent raw capability identity atomically", async () => {
		const t = convexTest(schema, modules);
		await seedClients(t);
		const first = await begin(t);
		const firstState = await journalState(t);
		expect(firstState.capabilities).toHaveLength(3);
		expect(new Set(firstState.capabilities.map(({ rawFingerprint }) => rawFingerprint)).size)
			.toBe(3);
		for (const capability of firstState.capabilities) {
			expect(capability.rawFingerprint).toBe(
				await catalogEditorRawCapabilityFingerprint(capability.value ?? ""),
			);
			expect(capability.digest).toBe(
				await catalogEditorCapabilityDigest(capability.purpose, capability.value ?? ""),
			);
		}

		resignFirstWorkerResponse = true;
		const crossOperation = await post(t, BEGIN_PATH, HOST_SECRET, printBegin(HANDLE_B));
		expect(crossOperation.status).toBe(410);
		const afterCollision = await journalState(t);
		expect(afterCollision.capabilities).toHaveLength(3);
		expect(afterCollision.capabilities.every(({ operationId }) => operationId === first.operationId))
			.toBe(true);

		const duplicatePurpose = convexTest(schema, modules);
		await seedClients(duplicatePurpose);
		vi.mocked(globalThis.fetch).mockImplementationOnce(async (_input, init) => {
			const requestBytes = requestBodyBytes(init?.body);
			const response = workerResponse();
			response.serverOnly.storageContinuation = response.uploadToken;
			return await signedWorkerResponse(response, requestBytes);
		});
		expect((await post(
			duplicatePurpose,
			BEGIN_PATH,
			HOST_SECRET,
			printBegin(),
		)).status).toBe(503);
		expect((await journalState(duplicatePurpose)).capabilities).toEqual([]);
	});

	test("exposes only the claimed purpose and replays committed ACK outcomes exactly", async () => {
		const t = convexTest(schema, modules);
		await seedClients(t);
		await begin(t);
		const storageClaim = await post(t, STORAGE_CLAIM_PATH, HOST_SECRET, { uploadHandle: HANDLE_A });
		const claim = await storageClaim.json() as { lease: string; storageContinuation: string };
		expect(claim.storageContinuation).toBe(token("b"));
		expect(JSON.stringify(claim)).not.toContain(token("c"));
		expect((await post(t, INSPECTION_CLAIM_PATH, INSPECTOR_SECRET, {})).status).toBe(429);
		const ackBody = { uploadHandle: HANDLE_A, lease: claim.lease, outcome: "retryable" };
		const first = await post(t, STORAGE_ACK_PATH, HOST_SECRET, ackBody);
		const replay = await post(t, STORAGE_ACK_PATH, HOST_SECRET, ackBody);
		expect(first.status).toBe(200);
		expect(await replay.json()).toEqual(await first.json());
		expect((await post(t, STORAGE_ACK_PATH, HOST_SECRET, {
			...ackBody,
			outcome: "success",
		})).status).toBe(409);
		const storageEffect = (await journalState(t)).effects.find(({ kind }) => kind === "storage");
		if (!storageEffect) throw new Error("missing storage effect fixture");
		await t.run(async (ctx) => await ctx.db.patch(storageEffect._id, { nextAttemptAt: 1 }));
		const nextClaim = await post(t, STORAGE_CLAIM_PATH, HOST_SECRET, { uploadHandle: HANDLE_A });
		const nextLease = await nextClaim.json() as { lease: string };
		const rejectedBody = {
			uploadHandle: HANDLE_A,
			lease: nextLease.lease,
			outcome: "rejected",
		};
		expect(await (await post(t, STORAGE_ACK_PATH, HOST_SECRET, rejectedBody)).json())
			.toEqual({ status: "rejected" });
		expect(await (await post(t, STORAGE_ACK_PATH, HOST_SECRET, rejectedBody)).json())
			.toEqual({ status: "rejected" });
	});

	test("durably records eight lost claim responses as attempts exhausted", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		const t = convexTest(schema, modules);
		await seedClients(t);
		await begin(t);
		for (let attempt = 0; attempt < 8; attempt += 1) {
			const response = await post(t, STORAGE_CLAIM_PATH, HOST_SECRET, { uploadHandle: HANDLE_A });
			expect(response.status).toBe(200);
			expect(await response.json()).toHaveProperty("storageContinuation");
			vi.setSystemTime(Date.now() + 60_001);
		}
		const exhausted = await post(t, STORAGE_CLAIM_PATH, HOST_SECRET, { uploadHandle: HANDLE_A });
		expect(await exhausted.json()).toEqual({ status: "attempts_exhausted" });
		const state = await journalState(t);
		expect(state.effects.find(({ kind }) => kind === "storage")).toMatchObject({
			state: "failed",
			attempts: 8,
			lastOutcome: "attempts_exhausted",
		});
		const status = await post(t, STATUS_PATH, HOST_SECRET, { uploadHandle: HANDLE_A });
		expect(await status.json()).toMatchObject({ status: "failed" });
	});

	test("routes an upload-expiry boundary into durable storage recovery", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		const t = convexTest(schema, modules);
		await seedClients(t);
		const begun = await begin(t);
		const uploadExpiresAt = new Date(begun.uploadExpiresAt).valueOf();

		vi.setSystemTime(uploadExpiresAt - 1);
		expect(await (await post(
			t,
			STATUS_PATH,
			HOST_SECRET,
			{ uploadHandle: HANDLE_A },
		)).json()).toMatchObject({ status: "upload_required" });

		// A PUT accepted in the final millisecond may lose its response. Once the
		// upload capability expires, status must preserve and direct the longer-
		// lived storage outbox instead of falsely terminalizing the journal.
		vi.setSystemTime(uploadExpiresAt);
		expect(await (await post(
			t,
			STATUS_PATH,
			HOST_SECRET,
			{ uploadHandle: HANDLE_A },
		)).json()).toMatchObject({ status: "storage_pending" });
		expect((await post(t, UPLOAD_PATH, HOST_SECRET, { uploadHandle: HANDLE_A })).status).toBe(410);
		const storageClaim = await post(
			t,
			STORAGE_CLAIM_PATH,
			HOST_SECRET,
			{ uploadHandle: HANDLE_A },
		);
		expect(storageClaim.status).toBe(200);
		expect(await storageClaim.json()).toHaveProperty("storageContinuation", token("b"));
		expect(await (await post(
			t,
			STATUS_PATH,
			HOST_SECRET,
			{ uploadHandle: HANDLE_A },
		)).json()).toMatchObject({ status: "storage_pending" });

		const receipts = await receiptsFor(begun.operationId);
		expect((await postReceipt(t, EDITOR_STORAGE_PATH, STORAGE_SECRET, receipts.storage)).status)
			.toBe(200);
		expect(await (await post(
			t,
			STATUS_PATH,
			HOST_SECRET,
			{ uploadHandle: HANDLE_A },
		)).json()).toMatchObject({ status: "inspection_pending" });
	});

	test("requires the complete storage and inspection budgets at exact expiry boundaries", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		const exactStorage = convexTest(schema, modules);
		await seedClients(exactStorage);
		await begin(exactStorage);
		const storageCapability = (await journalState(exactStorage)).capabilities.find(
			({ purpose }) => purpose === "storage",
		);
		if (!storageCapability) throw new Error("missing storage capability fixture");
		const storageExpiresAt = Date.now()
			+ CATALOG_EDITOR_STORAGE_LEASE_MS
			+ CATALOG_EDITOR_CLAIM_EXPIRY_SKEW_MS;
		await exactStorage.run(async (ctx) => await ctx.db.patch(
			storageCapability._id,
			{ expiresAt: storageExpiresAt },
		));
		const storageClaim = await post(
			exactStorage,
			STORAGE_CLAIM_PATH,
			HOST_SECRET,
			{ uploadHandle: HANDLE_A },
		);
		const storageBody = await storageClaim.json() as { leaseExpiresAt: string };
		const storageLeaseExpiresAt = new Date(storageBody.leaseExpiresAt).valueOf();
		expect(storageLeaseExpiresAt).toBe(Date.now() + CATALOG_EDITOR_STORAGE_LEASE_MS);
		expect(storageLeaseExpiresAt).toBeLessThan(storageExpiresAt);
		const uploadCapability = (await journalState(exactStorage)).capabilities.find(
			({ purpose }) => purpose === "upload",
		);
		if (!uploadCapability) throw new Error("missing upload capability fixture");
		await exactStorage.run(async (ctx) => await ctx.db.patch(
			uploadCapability._id,
			{ expiresAt: 1 },
		));
		vi.setSystemTime(storageLeaseExpiresAt - 1);
		expect(await (await post(
			exactStorage,
			STATUS_PATH,
			HOST_SECRET,
			{ uploadHandle: HANDLE_A },
		)).json()).toMatchObject({ status: "storage_pending" });
		vi.setSystemTime(storageLeaseExpiresAt);
		expect(await (await post(
			exactStorage,
			STATUS_PATH,
			HOST_SECRET,
			{ uploadHandle: HANDLE_A },
		)).json()).toMatchObject({ status: "expired" });

		const insufficientStorage = convexTest(schema, modules);
		await seedClients(insufficientStorage);
		await begin(insufficientStorage);
		const shortStorage = (await journalState(insufficientStorage)).capabilities.find(
			({ purpose }) => purpose === "storage",
		);
		if (!shortStorage) throw new Error("missing short storage capability fixture");
		await insufficientStorage.run(async (ctx) => await ctx.db.patch(shortStorage._id, {
			expiresAt: Date.now()
				+ CATALOG_EDITOR_STORAGE_LEASE_MS
				+ CATALOG_EDITOR_CLAIM_EXPIRY_SKEW_MS
				- 1,
		}));
		expect(await (await post(
			insufficientStorage,
			STATUS_PATH,
			HOST_SECRET,
			{ uploadHandle: HANDLE_A },
		)).json()).toMatchObject({ status: "expired" });
		expect(await (await post(
			insufficientStorage,
			STORAGE_CLAIM_PATH,
			HOST_SECRET,
			{ uploadHandle: HANDLE_A },
		)).json()).toEqual({ status: "capability_expired" });
		expect(await (await post(
			insufficientStorage,
			STATUS_PATH,
			HOST_SECRET,
			{ uploadHandle: HANDLE_A },
		)).json()).toMatchObject({ status: "expired" });

		const exactInspection = convexTest(schema, modules);
		await seedClients(exactInspection);
		const inspectionBegin = await begin(exactInspection);
		const receipts = await receiptsFor(inspectionBegin.operationId);
		expect((await postReceipt(
			exactInspection,
			EDITOR_STORAGE_PATH,
			STORAGE_SECRET,
			receipts.storage,
		)).status).toBe(200);
		const inspectionCapability = (await journalState(exactInspection)).capabilities.find(
			({ purpose }) => purpose === "inspection",
		);
		if (!inspectionCapability) throw new Error("missing inspection capability fixture");
		const inspectionExpiresAt = Date.now()
			+ CATALOG_EDITOR_INSPECTION_LEASE_MS
			+ CATALOG_EDITOR_CLAIM_EXPIRY_SKEW_MS;
		await exactInspection.run(async (ctx) => await ctx.db.patch(
			inspectionCapability._id,
			{ expiresAt: inspectionExpiresAt },
		));
		const inspectionClaim = await post(
			exactInspection,
			INSPECTION_CLAIM_PATH,
			INSPECTOR_SECRET,
			{},
		);
		const inspectionBody = await inspectionClaim.json() as { leaseExpiresAt: string };
		expect(new Date(inspectionBody.leaseExpiresAt).valueOf()).toBe(
			Date.now() + CATALOG_EDITOR_INSPECTION_LEASE_MS,
		);
		expect(new Date(inspectionBody.leaseExpiresAt).valueOf()).toBeLessThan(inspectionExpiresAt);
	});

	test("preserves a short-window inspection lease across storage replay, purge, ACK, and receipt", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		const t = convexTest(schema, modules);
		await seedClients(t);
		const begun = await begin(t);
		const receipts = await receiptsFor(begun.operationId);
		expect((await postReceipt(t, EDITOR_STORAGE_PATH, STORAGE_SECRET, receipts.storage)).status)
			.toBe(200);
		const inspection = (await journalState(t)).capabilities.find(
			({ purpose }) => purpose === "inspection",
		);
		if (!inspection) throw new Error("missing inspection capability fixture");
		const inspectionExpiresAt = Date.now()
			+ CATALOG_EDITOR_INSPECTION_LEASE_MS
			+ CATALOG_EDITOR_CLAIM_EXPIRY_SKEW_MS;
		await t.run(async (ctx) => await ctx.db.patch(inspection._id, {
			expiresAt: inspectionExpiresAt,
			purgeAt: 1,
		}));

		const claimResponse = await post(t, INSPECTION_CLAIM_PATH, INSPECTOR_SECRET, {});
		expect(claimResponse.status).toBe(200);
		const claim = await claimResponse.json() as {
			claimId: string;
			lease: string;
			leaseExpiresAt: string;
		};
		const leasedBeforeReplay = (await journalState(t)).effects.find(
			({ kind }) => kind === "inspection_dispatch",
		);
		expect(leasedBeforeReplay).toMatchObject({
			state: "leased",
			generation: inspection.generation,
			leaseExpiresAt: new Date(claim.leaseExpiresAt).valueOf(),
		});

		vi.setSystemTime(Date.now() + 1);
		expect(inspectionExpiresAt - Date.now()).toBeLessThan(
			CATALOG_EDITOR_INSPECTION_LEASE_MS + CATALOG_EDITOR_CLAIM_EXPIRY_SKEW_MS,
		);
		expect(inspectionExpiresAt).toBeGreaterThan(Date.now());
		expect((await postReceipt(t, EDITOR_STORAGE_PATH, STORAGE_SECRET, receipts.storage)).status)
			.toBe(200);
		const replayedState = await journalState(t);
		expect(replayedState.operations[0]).toMatchObject({ lifecycle: "storage_recorded" });
		expect(replayedState.effects.find(({ kind }) => kind === "inspection_dispatch"))
			.toEqual(leasedBeforeReplay);
		expect(await (await post(
			t,
			STATUS_PATH,
			HOST_SECRET,
			{ uploadHandle: HANDLE_A },
		)).json()).toMatchObject({ status: "inspection_pending" });

		expect((await t.mutation(internal.catalogPrivateAssets.purgeEditorCapability, {
			capabilityId: inspection._id,
			purpose: "inspection",
			digest: inspection.digest,
			generation: inspection.generation,
			purgeAt: 1,
		})).purged).toBe(false);
		const afterPurge = await journalState(t);
		expect(afterPurge.capabilities.find(({ _id }) => _id === inspection._id)?.value)
			.toBe(inspection.value);
		expect(afterPurge.effects.find(({ kind }) => kind === "inspection_dispatch"))
			.toEqual(leasedBeforeReplay);

		expect(await (await post(t, INSPECTION_ACK_PATH, INSPECTOR_SECRET, {
			claimId: claim.claimId,
			lease: claim.lease,
			outcome: "success",
		})).json()).toEqual({ status: "acknowledged" });
		expect((await postReceipt(
			t,
			EDITOR_INSPECTION_PATH,
			INSPECTION_RECEIPT_SECRET,
			receipts.inspection,
		)).status).toBe(200);
		expect(await (await post(
			t,
			STATUS_PATH,
			HOST_SECRET,
			{ uploadHandle: HANDLE_A },
		)).json()).toMatchObject({ status: "verified" });
	});

	test("does not purge a continuation during a valid lost-response lease", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		const t = convexTest(schema, modules);
		await seedClients(t);
		await begin(t);
		const storage = (await journalState(t)).capabilities.find(
			({ purpose }) => purpose === "storage",
		);
		if (!storage) throw new Error("missing storage capability fixture");
		await t.run(async (ctx) => await ctx.db.patch(storage._id, { purgeAt: 1 }));
		const claim = await post(t, STORAGE_CLAIM_PATH, HOST_SECRET, { uploadHandle: HANDLE_A });
		expect(claim.status).toBe(200);
		expect((await t.mutation(internal.catalogPrivateAssets.purgeEditorCapability, {
			capabilityId: storage._id,
			purpose: "storage",
			digest: storage.digest,
			generation: storage.generation,
			purgeAt: 1,
		})).purged).toBe(false);
		expect((await journalState(t)).capabilities.find(({ _id }) => _id === storage._id)?.value)
			.toBe(storage.value);
	});

	test("accepts claim → receipt-producing Worker completion → ACK for both roles", async () => {
		const t = convexTest(schema, modules);
		await seedClients(t);
		const begun = await begin(t);
		const receipts = await receiptsFor(begun.operationId);
		const storageClaim = await post(t, STORAGE_CLAIM_PATH, HOST_SECRET, { uploadHandle: HANDLE_A });
		const storageLease = await storageClaim.json() as { lease: string };
		expect((await postReceipt(t, EDITOR_STORAGE_PATH, STORAGE_SECRET, receipts.storage)).status)
			.toBe(200);
		const storageAck = {
			uploadHandle: HANDLE_A,
			lease: storageLease.lease,
			outcome: "success",
		};
		expect(await (await post(t, STORAGE_ACK_PATH, HOST_SECRET, storageAck)).json())
			.toEqual({ status: "acknowledged" });
		expect(await (await post(t, STORAGE_ACK_PATH, HOST_SECRET, storageAck)).json())
			.toEqual({ status: "acknowledged" });

		const inspectionClaim = await post(t, INSPECTION_CLAIM_PATH, INSPECTOR_SECRET, {});
		const inspectionLease = await inspectionClaim.json() as {
			claimId: string;
			lease: string;
			inspectionContinuation: string;
		};
		expect(inspectionLease.inspectionContinuation).toBe(token("c"));
		expect((await postReceipt(
			t,
			EDITOR_INSPECTION_PATH,
			INSPECTION_RECEIPT_SECRET,
			receipts.inspection,
		)).status).toBe(200);
		const inspectionAck = {
			claimId: inspectionLease.claimId,
			lease: inspectionLease.lease,
			outcome: "success",
		};
		expect(await (await post(t, INSPECTION_ACK_PATH, INSPECTOR_SECRET, inspectionAck)).json())
			.toEqual({ status: "acknowledged" });
		expect(await (await post(t, INSPECTION_ACK_PATH, INSPECTOR_SECRET, inspectionAck)).json())
			.toEqual({ status: "acknowledged" });
		const verified = await post(t, STATUS_PATH, HOST_SECRET, { uploadHandle: HANDLE_A });
		const verifiedText = await verified.text();
		expect(JSON.parse(verifiedText)).toMatchObject({
			status: "verified",
			asset: { status: "verified" },
		});
		expect(verifiedText).not.toMatch(
			/operationId|uploadHandleHash|sha256|privateObjectKey|receiptSet|capability|lease|sourceId/i,
		);
	});

	test("reconciles inspection-first evidence without queuing premature work", async () => {
		const t = convexTest(schema, modules);
		await seedClients(t);
		const begun = await begin(t);
		const receipts = await receiptsFor(begun.operationId);
		expect((await postReceipt(
			t,
			EDITOR_INSPECTION_PATH,
			INSPECTION_RECEIPT_SECRET,
			receipts.inspection,
		)).status).toBe(200);
		expect((await journalState(t)).effects.some(({ kind }) => kind === "inspection_dispatch"))
			.toBe(false);
		expect((await postReceipt(t, EDITOR_STORAGE_PATH, STORAGE_SECRET, receipts.storage)).status)
			.toBe(200);
		expect((await journalState(t)).effects.find(({ kind }) => kind === "inspection_dispatch"))
			.toMatchObject({ state: "acknowledged" });
	});

	test("terminalizes storage evidence that arrives after inspection capability purge", async () => {
		const t = convexTest(schema, modules);
		await seedClients(t);
		const begun = await begin(t);
		const receipts = await receiptsFor(begun.operationId);
		const inspection = (await journalState(t)).capabilities.find(
			({ purpose }) => purpose === "inspection",
		);
		if (!inspection) throw new Error("missing inspection capability fixture");
		await t.run(async (ctx) => await ctx.db.patch(inspection._id, { purgeAt: 1 }));
		expect((await t.mutation(internal.catalogPrivateAssets.purgeEditorCapability, {
			capabilityId: inspection._id,
			purpose: "inspection",
			digest: inspection.digest,
			generation: inspection.generation,
			purgeAt: 1,
		})).purged).toBe(true);
		expect((await postReceipt(t, EDITOR_STORAGE_PATH, STORAGE_SECRET, receipts.storage)).status)
			.toBe(200);
		const state = await journalState(t);
		expect(state.operations[0]).toMatchObject({ lifecycle: "expired" });
		expect(state.effects.find(({ kind }) => kind === "inspection_dispatch"))
			.toMatchObject({ state: "failed", lastOutcome: "expired" });
		const status = await post(t, STATUS_PATH, HOST_SECRET, { uploadHandle: HANDLE_A });
		expect(await status.json()).toMatchObject({ status: "expired" });
	});

	test("keeps journal product-kind resolution exact after verification", async () => {
		const t = convexTest(schema, modules);
		await seedClients(t);
		const begun = await begin(t);
		const receipts = await receiptsFor(begun.operationId);
		await postReceipt(t, EDITOR_STORAGE_PATH, STORAGE_SECRET, receipts.storage);
		await postReceipt(t, EDITOR_INSPECTION_PATH, INSPECTION_RECEIPT_SECRET, receipts.inspection);
		const admin = t.withIdentity({ subject: ADMIN_EMAIL, email: ADMIN_EMAIL });
		await expect(admin.query(api.catalogPrivateAssets.resolveEditorUpload, {
			siteUrl: SITE,
			operationId: begun.operationId,
			productKind: "print_set",
		})).rejects.toThrow(/not verified/i);
		await expect(admin.query(api.catalogPrivateAssets.resolveEditorUpload, {
			siteUrl: SITE,
			operationId: begun.operationId,
			productKind: "print",
		})).resolves.toMatchObject({ kind: "print_source" });
	});

	test("rolls back declaration-mismatched receipts without partial authority writes", async () => {
		const t = convexTest(schema, modules);
		await seedClients(t);
		const begun = await begin(t);
		const facts = editorPrintFacts(SITE, begun.operationId);
		facts.originalFilename = "journal-source.jpg";
		facts.sha256 = "e".repeat(64);
		const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE, [facts], 2);
		const response = await postReceipt(
			t,
			EDITOR_STORAGE_PATH,
			STORAGE_SECRET,
			editorStorageSetV2(receiptSetId, facts),
		);
		expect(response.status).toBe(409);
		const rows = await t.run(async (ctx) => ({
			operation: (await ctx.db.query("catalogPrivateAssetEditorOperations").take(1))[0],
			coordinations: await ctx.db.query("catalogPrivateAssetReceiptCoordinations").take(10),
			targets: await ctx.db.query("catalogPrivateAssetTargetAuthorities").take(10),
			assets: await ctx.db.query("catalogPrintSourceAssets").take(10),
		}));
		expect(rows.operation?.receiptSetId).toBeUndefined();
		expect(rows.coordinations).toEqual([]);
		expect(rows.targets).toEqual([]);
		expect(rows.assets).toEqual([]);
	});

	test("purges by exact capability identity while retaining a non-secret tombstone", async () => {
		const t = convexTest(schema, modules);
		await seedClients(t);
		await begin(t);
		const upload = (await journalState(t)).capabilities.find(({ purpose }) => purpose === "upload");
		if (!upload) throw new Error("missing upload capability fixture");
		await t.run(async (ctx) => await ctx.db.patch(upload._id, { purgeAt: 1 }));
		expect((await t.mutation(internal.catalogPrivateAssets.purgeEditorCapability, {
			capabilityId: upload._id,
			purpose: "upload",
			digest: "0".repeat(64),
			generation: upload.generation,
			purgeAt: 1,
		})).purged).toBe(false);
		expect((await t.mutation(internal.catalogPrivateAssets.purgeEditorCapability, {
			capabilityId: upload._id,
			purpose: "upload",
			digest: upload.digest,
			generation: upload.generation,
			purgeAt: 1,
		})).purged).toBe(true);
		const tombstone = (await journalState(t)).capabilities.find(({ _id }) => _id === upload._id);
		expect(tombstone).toMatchObject({ purpose: "upload", digest: upload.digest, generation: 1 });
		expect(tombstone?.value).toBeUndefined();
		expect((await post(t, UPLOAD_PATH, HOST_SECRET, { uploadHandle: HANDLE_A })).status).toBe(410);
	});
});

describe("catalog editor inspection global single-flight", () => {
	test("serializes Promise-submitted two-tenant claims to one lease", async () => {
		const t = convexTest(schema, modules);
		// convex-test locks top-level transactions, so Promise.all does not create
		// parallel snapshots. This covers the invariant after its serialized calls;
		// deployed Convex supplies the serializable index-range retry.
		await seedInspectionJob(t, { siteUrl: SITE, key: "a" });
		await seedInspectionJob(t, { siteUrl: OTHER_SITE, key: "b" });

		const responses = await Promise.all([
			post(t, INSPECTION_CLAIM_PATH, INSPECTOR_SECRET, {}),
			post(t, INSPECTION_CLAIM_PATH, OTHER_INSPECTOR_SECRET, {}),
		]);
		expect(responses.map(({ status }) => status).sort()).toEqual([200, 429]);
		const winner = responses.find(({ status }) => status === 200);
		if (!winner) throw new Error("missing single-flight winner");
		expect(await winner.json()).toMatchObject({
			claimId: expect.any(String),
			inspectionContinuation: expect.stringContaining("cms-editor-upload-v1."),
			lease: expect.stringMatching(/^[0-9a-f]{40}$/),
		});
		const state = await journalState(t);
		expect(state.effects.filter(({ state }) => state === "leased")).toHaveLength(1);
		expect(state.effects.reduce((attempts, effect) => attempts + effect.attempts, 0)).toBe(1);
		expect(state.effects.find(({ state }) => state === "queued")).toMatchObject({ attempts: 0 });
	});

	test("serializes many Promise-submitted claims without charging losing attempts", async () => {
		const t = convexTest(schema, modules);
		for (const [index, key] of [..."cdefgh"].entries()) {
			await seedInspectionJob(t, {
				siteUrl: index % 2 === 0 ? SITE : OTHER_SITE,
				key,
			});
		}
		const responses = await Promise.all(Array.from({ length: 12 }, async (_, index) =>
			await post(
				t,
				INSPECTION_CLAIM_PATH,
				index % 2 === 0 ? INSPECTOR_SECRET : OTHER_INSPECTOR_SECRET,
				{},
			)
		));
		expect(responses.filter(({ status }) => status === 200)).toHaveLength(1);
		expect(responses.filter(({ status }) => status === 429)).toHaveLength(11);
		const effects = (await journalState(t)).effects;
		expect(effects.filter(({ state }) => state === "leased")).toHaveLength(1);
		expect(effects.filter(({ attempts }) => attempts === 1)).toHaveLength(1);
		expect(effects.filter(({ attempts }) => attempts === 0)).toHaveLength(5);
	});

	test("moves a lease mutation through the exact active and stale index ranges", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
		const t = convexTest(schema, modules);
		const job = await seedInspectionJob(t, { siteUrl: SITE, key: "w" });
		const membership = await t.run(async (ctx) => {
			const activeIds = async () => (await ctx.db
				.query("catalogPrivateAssetEditorEffects")
				.withIndex("by_kind_and_state_and_leaseExpiresAt", (q) =>
					q.eq("kind", "inspection_dispatch")
						.eq("state", "leased")
						.gt("leaseExpiresAt", Date.now()),
				)
				.take(10)).map(({ _id }) => _id);
			const staleIds = async () => (await ctx.db
				.query("catalogPrivateAssetEditorEffects")
				.withIndex("by_siteUrl_and_kind_and_state_and_leaseExpiresAt", (q) =>
					q.eq("siteUrl", SITE)
						.eq("kind", "inspection_dispatch")
						.eq("state", "leased")
						.lte("leaseExpiresAt", Date.now()),
				)
				.take(10)).map(({ _id }) => _id);
			const before = await activeIds();
			await ctx.db.patch(job.effectId, {
				state: "leased",
				leaseDigest: "w".repeat(64),
				leaseExpiresAt: Date.now() + CATALOG_EDITOR_INSPECTION_LEASE_MS,
			});
			const active = await activeIds();
			await ctx.db.patch(job.effectId, { leaseExpiresAt: Date.now() });
			return { before, active, after: await activeIds(), stale: await staleIds() };
		});
		expect(membership).toEqual({
			before: [],
			active: [job.effectId],
			after: [],
			stale: [job.effectId],
		});
	});

	test("leaves foreign terminal leases for exact one-shot owner outcomes", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
		const t = convexTest(schema, modules);
		const exhausted = await seedInspectionJob(t, {
			siteUrl: SITE,
			key: "x",
			state: "leased",
			attempts: 8,
			leaseExpiresAt: Date.now(),
		});
		const expired = await seedInspectionJob(t, {
			siteUrl: SITE,
			key: "y",
			state: "leased",
			attempts: 1,
			capabilityExpiresAt: Date.now(),
			leaseExpiresAt: Date.now(),
		});
		const foreignDue = await seedInspectionJob(t, { siteUrl: OTHER_SITE, key: "z" });

		const foreignClaim = await post(t, INSPECTION_CLAIM_PATH, OTHER_INSPECTOR_SECRET, {});
		expect(foreignClaim.status).toBe(200);
		const foreignClaimBody = await foreignClaim.json() as { claimId: string; lease: string };
		expect(foreignClaimBody).toMatchObject({ claimId: foreignDue.effectId });
		let state = await journalState(t);
		const untouchedExhausted = state.effects.find(({ _id }) => _id === exhausted.effectId);
		const untouchedExpired = state.effects.find(({ _id }) => _id === expired.effectId);
		expect(untouchedExhausted).toMatchObject({ state: "leased", attempts: 8 });
		expect(untouchedExhausted?.lastOutcome).toBeUndefined();
		expect(untouchedExpired).toMatchObject({ state: "leased", attempts: 1 });
		expect(untouchedExpired?.lastOutcome).toBeUndefined();

		expect((await post(t, INSPECTION_ACK_PATH, OTHER_INSPECTOR_SECRET, {
			claimId: foreignClaimBody.claimId,
			lease: foreignClaimBody.lease,
			outcome: "success",
		})).status).toBe(200);
		const terminalBodies = [];
		for (let index = 0; index < 2; index += 1) {
			const response = await post(t, INSPECTION_CLAIM_PATH, INSPECTOR_SECRET, {});
			expect(response.status).toBe(200);
			terminalBodies.push(await response.json());
		}
		expect(terminalBodies).toEqual([
			{ claimId: exhausted.effectId, status: "attempts_exhausted" },
			{ claimId: expired.effectId, status: "capability_expired" },
		]);
		expect((await post(t, INSPECTION_CLAIM_PATH, INSPECTOR_SECRET, {})).status).toBe(429);
		state = await journalState(t);
		expect(state.effects.find(({ _id }) => _id === exhausted.effectId)).toMatchObject({
			state: "failed",
			lastOutcome: "attempts_exhausted",
		});
		expect(state.effects.find(({ _id }) => _id === expired.effectId)).toMatchObject({
			state: "failed",
			lastOutcome: "expired",
		});
	});

	test("indexes legacy absent expiry and fails closed until its owner repairs it", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
		const t = convexTest(schema, modules);
		const malformed = await seedInspectionJob(t, {
			siteUrl: OTHER_SITE,
			key: "A",
			state: "leased",
			attempts: 1,
			omitLeaseExpiresAt: true,
		});
		const terminalMalformed = await seedInspectionJob(t, {
			siteUrl: OTHER_SITE,
			key: "D",
			state: "leased",
			attempts: 8,
			omitLeaseExpiresAt: true,
		});
		const due = await seedInspectionJob(t, { siteUrl: SITE, key: "B" });
		const indexed = await t.run(async (ctx) => ({
			global: await ctx.db
				.query("catalogPrivateAssetEditorEffects")
				.withIndex("by_kind_and_state_and_leaseExpiresAt", (q) =>
					q.eq("kind", "inspection_dispatch")
						.eq("state", "leased")
						.eq("leaseExpiresAt", undefined),
				)
				.take(10),
			tenantStale: await ctx.db
				.query("catalogPrivateAssetEditorEffects")
				.withIndex("by_siteUrl_and_kind_and_state_and_leaseExpiresAt", (q) =>
					q.eq("siteUrl", OTHER_SITE)
						.eq("kind", "inspection_dispatch")
						.eq("state", "leased")
						.lte("leaseExpiresAt", Date.now()),
				)
				.take(10),
		}));
		expect(indexed.global.map(({ _id }) => _id)).toEqual([
			malformed.effectId,
			terminalMalformed.effectId,
		]);
		expect(indexed.tenantStale.map(({ _id }) => _id)).toEqual([
			malformed.effectId,
			terminalMalformed.effectId,
		]);

		expect((await post(t, INSPECTION_CLAIM_PATH, INSPECTOR_SECRET, {})).status).toBe(429);
		let state = await journalState(t);
		expect(state.effects.find(({ _id }) => _id === due.effectId)).toMatchObject({
			state: "queued",
			attempts: 0,
		});
		expect(state.effects.find(({ _id }) => _id === malformed.effectId)?.leaseExpiresAt)
			.toBeUndefined();

		const terminalized = await post(t, INSPECTION_CLAIM_PATH, OTHER_INSPECTOR_SECRET, {});
		expect(terminalized.status).toBe(200);
		expect(await terminalized.json()).toEqual({
			claimId: terminalMalformed.effectId,
			status: "attempts_exhausted",
		});
		const repaired = await post(t, INSPECTION_CLAIM_PATH, OTHER_INSPECTOR_SECRET, {});
		expect(repaired.status).toBe(200);
		expect(await repaired.json()).toMatchObject({ claimId: malformed.effectId });
		state = await journalState(t);
		expect(state.effects.find(({ _id }) => _id === malformed.effectId)).toMatchObject({
			state: "leased",
			attempts: 2,
			leaseExpiresAt: Date.now() + CATALOG_EDITOR_INSPECTION_LEASE_MS,
		});
	});

	test("foreign expired leases neither block fresh work nor get reconciled", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
		const t = convexTest(schema, modules);
		const stale = await seedInspectionJob(t, {
			siteUrl: SITE,
			key: "i",
			state: "leased",
			attempts: 1,
			leaseExpiresAt: Date.now(),
		});
		const other = await seedInspectionJob(t, { siteUrl: OTHER_SITE, key: "j" });

		const otherResponse = await post(t, INSPECTION_CLAIM_PATH, OTHER_INSPECTOR_SECRET, {});
		expect(otherResponse.status).toBe(200);
		const otherClaim = await otherResponse.json() as { claimId: string; lease: string };
		expect(otherClaim.claimId).toBe(other.effectId);
		let state = await journalState(t);
		expect(state.effects.find(({ _id }) => _id === stale.effectId)).toMatchObject({
			state: "leased",
			attempts: 1,
			leaseDigest: "i".repeat(64),
			leaseExpiresAt: Date.now(),
		});

		expect((await post(t, INSPECTION_ACK_PATH, OTHER_INSPECTOR_SECRET, {
			claimId: otherClaim.claimId,
			lease: otherClaim.lease,
			outcome: "success",
		})).status).toBe(200);
		const recoveredResponse = await post(t, INSPECTION_CLAIM_PATH, INSPECTOR_SECRET, {});
		expect(recoveredResponse.status).toBe(200);
		expect(await recoveredResponse.json()).toMatchObject({ claimId: stale.effectId });
		state = await journalState(t);
		expect(state.effects.find(({ _id }) => _id === stale.effectId)).toMatchObject({
			state: "leased",
			attempts: 2,
		});
	});

	test("globally blocks on a current lease without consuming a different tenant job", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
		const t = convexTest(schema, modules);
		const active = await seedInspectionJob(t, {
			siteUrl: SITE,
			key: "k",
			state: "leased",
			attempts: 1,
			leaseExpiresAt: Date.now() + CATALOG_EDITOR_INSPECTION_LEASE_MS,
		});
		const queued = await seedInspectionJob(t, { siteUrl: OTHER_SITE, key: "l" });
		const response = await post(t, INSPECTION_CLAIM_PATH, OTHER_INSPECTOR_SECRET, {});
		expect(response.status).toBe(429);
		expect(await response.text()).toBe("Work is not currently claimable");
		const state = await journalState(t);
		expect(state.effects.find(({ _id }) => _id === active.effectId)).toMatchObject({
			state: "leased",
			attempts: 1,
		});
		expect(state.effects.find(({ _id }) => _id === queued.effectId)).toMatchObject({
			state: "queued",
			attempts: 0,
		});
	});

	test("reconciles stale generation and capability failures without touching newer authority", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
		const t = convexTest(schema, modules);
		const generationMismatch = await seedInspectionJob(t, {
			siteUrl: SITE,
			key: "m",
			state: "leased",
			attempts: 1,
			operationGeneration: 2,
			leaseExpiresAt: Date.now(),
		});
		const expiredCapability = await seedInspectionJob(t, {
			siteUrl: SITE,
			key: "n",
			state: "leased",
			attempts: 1,
			capabilityExpiresAt: Date.now()
				+ CATALOG_EDITOR_INSPECTION_LEASE_MS
				+ CATALOG_EDITOR_CLAIM_EXPIRY_SKEW_MS
				- 1,
			leaseExpiresAt: Date.now(),
		});
		const due = await seedInspectionJob(t, { siteUrl: SITE, key: "o" });

		const firstTerminal = await post(t, INSPECTION_CLAIM_PATH, INSPECTOR_SECRET, {});
		expect(firstTerminal.status).toBe(200);
		expect(await firstTerminal.json()).toEqual({
			claimId: generationMismatch.effectId,
			status: "capability_expired",
		});
		const secondTerminal = await post(t, INSPECTION_CLAIM_PATH, INSPECTOR_SECRET, {});
		expect(secondTerminal.status).toBe(200);
		expect(await secondTerminal.json()).toEqual({
			claimId: expiredCapability.effectId,
			status: "capability_expired",
		});
		const response = await post(t, INSPECTION_CLAIM_PATH, INSPECTOR_SECRET, {});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ claimId: due.effectId });
		const state = await journalState(t);
		expect(state.effects.find(({ _id }) => _id === generationMismatch.effectId)).toMatchObject({
			state: "failed",
			lastOutcome: "expired",
			attempts: 1,
		});
		expect(state.operations.find(({ _id }) => _id === generationMismatch.operationIdRow))
			.toMatchObject({ lifecycle: "storage_recorded", generation: 2 });
		expect(state.effects.find(({ _id }) => _id === expiredCapability.effectId)).toMatchObject({
			state: "failed",
			lastOutcome: "expired",
			attempts: 1,
		});
		expect(state.operations.find(({ _id }) => _id === expiredCapability.operationIdRow))
			.toMatchObject({ lifecycle: "expired", generation: 1 });
	});

	test("verified receipt authority reconciles attempt 8 and accepts its late success ACK", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
		const t = convexTest(schema, modules);
		const verified = await seedInspectionJob(t, {
			siteUrl: SITE,
			key: "C",
			attempts: 7,
		});
		const claimResponse = await post(t, INSPECTION_CLAIM_PATH, INSPECTOR_SECRET, {});
		expect(claimResponse.status).toBe(200);
		const claim = await claimResponse.json() as {
			claimId: string;
			lease: string;
			leaseExpiresAt: string;
		};
		expect(claim.claimId).toBe(verified.effectId);
		await t.run(async (ctx) => {
			await ctx.db.patch(verified.operationIdRow, { lifecycle: "verified" });
		});
		vi.setSystemTime(new Date(claim.leaseExpiresAt));

		expect((await post(t, INSPECTION_CLAIM_PATH, INSPECTOR_SECRET, {})).status).toBe(429);
		let effect = (await journalState(t)).effects.find(({ _id }) => _id === verified.effectId);
		expect(effect).toMatchObject({
			state: "acknowledged",
			attempts: 8,
			lastOutcome: "reconciled",
			leaseExpiresAt: Date.parse(claim.leaseExpiresAt),
		});
		expect(effect?.leaseDigest).toBeDefined();

		const lateAck = {
			claimId: claim.claimId,
			lease: claim.lease,
			outcome: "success",
		};
		expect(await (await post(t, INSPECTION_ACK_PATH, INSPECTOR_SECRET, lateAck)).json())
			.toEqual({ status: "acknowledged" });
		expect(await (await post(t, INSPECTION_ACK_PATH, INSPECTOR_SECRET, lateAck)).json())
			.toEqual({ status: "acknowledged" });
		effect = (await journalState(t)).effects.find(({ _id }) => _id === verified.effectId);
		expect(effect).toMatchObject({
			state: "acknowledged",
			attempts: 8,
			lastOutcome: "success",
		});
	});

	test("commits stale attempt exhaustion as an exact one-shot terminal response", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
		const t = convexTest(schema, modules);
		const exhausted = await seedInspectionJob(t, {
			siteUrl: SITE,
			key: "p",
			state: "leased",
			attempts: 8,
			leaseExpiresAt: Date.now(),
		});
		const response = await post(t, INSPECTION_CLAIM_PATH, INSPECTOR_SECRET, {});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			claimId: exhausted.effectId,
			status: "attempts_exhausted",
		});
		expect((await journalState(t)).effects.find(({ _id }) => _id === exhausted.effectId))
			.toMatchObject({ state: "failed", attempts: 8, lastOutcome: "attempts_exhausted" });
		expect((await post(t, INSPECTION_CLAIM_PATH, INSPECTOR_SECRET, {})).status).toBe(429);
	});

	test("does not spend the reconciliation bound on another tenant's stale rows", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
		const t = convexTest(schema, modules);
		const stale = [];
		for (const key of [..."abcdefghijklmnopqr"]) {
			stale.push(await seedInspectionJob(t, {
				siteUrl: OTHER_SITE,
				key,
				state: "leased",
				attempts: 1,
				leaseExpiresAt: Date.now(),
			}));
		}
		const due = await seedInspectionJob(t, { siteUrl: SITE, key: "s" });
		const response = await post(t, INSPECTION_CLAIM_PATH, INSPECTOR_SECRET, {});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ claimId: due.effectId });
		const effects = (await journalState(t)).effects;
		const staleEffects = stale.map(({ effectId }) =>
			effects.find(({ _id }) => _id === effectId)
		);
		expect(staleEffects.filter((effect) => effect?.state === "queued")).toHaveLength(0);
		expect(staleEffects.filter((effect) => effect?.state === "leased")).toHaveLength(18);
		expect(staleEffects.every((effect) => effect?.attempts === 1)).toBe(true);
	});

	test("releases the gate on retry ACK, replays ACKs, and fences them after the next claim", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
		const t = convexTest(schema, modules);
		await seedInspectionJob(t, { siteUrl: SITE, key: "t" });
		await seedInspectionJob(t, { siteUrl: OTHER_SITE, key: "u" });
		const firstResponse = await post(t, INSPECTION_CLAIM_PATH, INSPECTOR_SECRET, {});
		const firstClaim = await firstResponse.json() as { claimId: string; lease: string };
		const retryAck = {
			claimId: firstClaim.claimId,
			lease: firstClaim.lease,
			outcome: "retryable",
		};
		const firstAck = await post(t, INSPECTION_ACK_PATH, INSPECTOR_SECRET, retryAck);
		const firstAckBody = await firstAck.json() as { status: string; retryAt: string };
		expect(firstAckBody).toMatchObject({ status: "retry_scheduled" });
		expect(await (await post(t, INSPECTION_ACK_PATH, INSPECTOR_SECRET, retryAck)).json())
			.toEqual(firstAckBody);

		const otherResponse = await post(t, INSPECTION_CLAIM_PATH, OTHER_INSPECTOR_SECRET, {});
		expect(otherResponse.status).toBe(200);
		const otherClaim = await otherResponse.json() as { claimId: string; lease: string };
		const successAck = {
			claimId: otherClaim.claimId,
			lease: otherClaim.lease,
			outcome: "success",
		};
		expect(await (await post(
			t,
			INSPECTION_ACK_PATH,
			OTHER_INSPECTOR_SECRET,
			successAck,
		)).json()).toEqual({ status: "acknowledged" });
		expect(await (await post(
			t,
			INSPECTION_ACK_PATH,
			OTHER_INSPECTOR_SECRET,
			successAck,
		)).json()).toEqual({ status: "acknowledged" });

		vi.setSystemTime(new Date(firstAckBody.retryAt));
		const retryResponse = await post(t, INSPECTION_CLAIM_PATH, INSPECTOR_SECRET, {});
		expect(retryResponse.status).toBe(200);
		expect((await retryResponse.json() as { claimId: string }).claimId).toBe(firstClaim.claimId);
		expect((await post(t, INSPECTION_ACK_PATH, INSPECTOR_SECRET, retryAck)).status).toBe(409);
		const effect = (await journalState(t)).effects.find(({ _id }) => _id === firstClaim.claimId);
		expect(effect).toMatchObject({ state: "leased", attempts: 2 });
	});

	test("does not apply the inspection gate to storage claims", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
		const t = convexTest(schema, modules);
		await seedClients(t);
		const active = await seedInspectionJob(t, {
			siteUrl: OTHER_SITE,
			key: "v",
			state: "leased",
			attempts: 1,
			leaseExpiresAt: Date.now() + CATALOG_EDITOR_INSPECTION_LEASE_MS,
		});
		await begin(t);
		expect((await post(t, INSPECTION_CLAIM_PATH, INSPECTOR_SECRET, {})).status).toBe(429);
		const storageResponse = await post(
			t,
			STORAGE_CLAIM_PATH,
			HOST_SECRET,
			{ uploadHandle: HANDLE_A },
		);
		expect(storageResponse.status).toBe(200);
		expect(await storageResponse.json()).toHaveProperty("storageContinuation", token("b"));
		expect((await journalState(t)).effects.find(({ _id }) => _id === active.effectId))
			.toMatchObject({ state: "leased", attempts: 1 });
	});
});
