/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { api as packageApi } from "../src/api";
import {
	DOCUMENT_EMAIL_MAX_CLAIMS,
	DOCUMENT_EMAIL_MAX_PORTAL_CAPABILITIES_PER_DOCUMENT,
	DOCUMENT_EMAIL_NEGATIVE_RESOLUTION_DELAY_MS,
	DOCUMENT_EMAIL_RECONCILIATION_WINDOW_MS,
	DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES,
} from "./documentEmailAttempts";

const modules = import.meta.glob("./**/*.ts");
const SITE_A = "tenant-a.example";
const SITE_B = "tenant-b.example";
const ADMIN_A = "admin-a@example.com";
const ADMIN_B = "admin-b@example.com";
const CLIENT_EMAIL = "client@example.com";
const ATTEMPT_ID = "123e4567-e89b-42d3-a456-426614174000";
const SECOND_ATTEMPT_ID = "123e4567-e89b-42d3-a456-426614174001";
const THIRD_ATTEMPT_ID = "123e4567-e89b-42d3-a456-426614174002";
const PORTAL_TOKEN = "123e4567-e89b-42d3-a456-426614174010";
const SECOND_PORTAL_TOKEN = "123e4567-e89b-42d3-a456-426614174011";
const THIRD_PORTAL_TOKEN = "123e4567-e89b-42d3-a456-426614174012";
const CLAIM_ID = "123e4567-e89b-42d3-a456-426614174020";
const SECOND_CLAIM_ID = "123e4567-e89b-42d3-a456-426614174021";
const THIRD_CLAIM_ID = "123e4567-e89b-42d3-a456-426614174022";

type Attempt = Doc<"documentEmailAttempts">;
type DocumentReference =
	| { type: "invoice"; id: Id<"invoices"> }
	| { type: "quote"; id: Id<"quotes"> }
	| { type: "contract"; id: Id<"contracts"> };
type Envelope = Attempt["envelope"];
type PrepareArgs = {
	siteUrl: string;
	attemptId: string;
	document: DocumentReference;
	portalOrigin: string;
	portalToken: string;
	portalExpiresAt?: number;
	envelope: Envelope;
};

// These aliases deliberately come through the generated public package surface.
// A stale codegen artifact therefore fails both this fixture and package tsc.
const prepareAttempt = packageApi.documentEmailAttempts.prepare;
const getAttempt = packageApi.documentEmailAttempts.get;
const getRecovery = packageApi.documentEmailAttempts.getRecovery;
const getOpenRecoveryByDocument = packageApi.documentEmailAttempts.getOpenRecoveryByDocument;
const claimAttempt = packageApi.documentEmailAttempts.claim;
const completeAttempt = packageApi.documentEmailAttempts.complete;
const failAttempt = packageApi.documentEmailAttempts.fail;
const resolveAttempt = packageApi.documentEmailAttempts.resolve;

afterEach(() => {
	vi.useRealTimers();
});

async function setup() {
	const t = convexTest(schema, modules);
	await t.mutation(internal.platform.seedClient, {
		name: "Tenant A",
		email: ADMIN_A,
		siteUrl: SITE_A,
		tier: "full",
		subscriptionStatus: "active",
		adminEmails: [ADMIN_A],
		role: "client",
	});
	await t.mutation(internal.platform.seedClient, {
		name: "Tenant B",
		email: ADMIN_B,
		siteUrl: SITE_B,
		tier: "full",
		subscriptionStatus: "active",
		adminEmails: [ADMIN_B],
		role: "client",
	});
	const adminA = t.withIdentity({ subject: ADMIN_A, email: ADMIN_A });
	const adminB = t.withIdentity({ subject: ADMIN_B, email: ADMIN_B });
	const clientId = await adminA.mutation(api.crm.createClient, {
		siteUrl: SITE_A,
		name: "Primary client",
		email: CLIENT_EMAIL,
		category: "photography",
		type: "portrait",
	});
	const otherClientId = await adminA.mutation(api.crm.createClient, {
		siteUrl: SITE_A,
		name: "Other client",
		email: "other@example.com",
		category: "photography",
		type: "portrait",
	});
	return { t, adminA, adminB, clientId, otherClientId };
}

function envelope(portalToken = PORTAL_TOKEN): Envelope {
	const portalUrl = `https://${SITE_A}/portal/${portalToken}`;
	return {
		from: "Angels Rest <studio@angelsrest.online>",
		to: CLIENT_EMAIL,
		replyTo: "studio@angelsrest.online",
		subject: "Your invoice",
		text: `View your invoice: ${portalUrl}`,
		html: `<p>View your invoice at <a href="${portalUrl}">${portalUrl}</a>.</p>`,
	};
}

function prepareArgs(
	document: DocumentReference,
	overrides: Partial<PrepareArgs> = {},
): PrepareArgs {
	return {
		siteUrl: SITE_A,
		attemptId: ATTEMPT_ID,
		document,
		portalOrigin: `https://${SITE_A}`,
		portalToken: PORTAL_TOKEN,
		envelope: envelope(),
		...overrides,
	};
}

function alternatePrepareArgs(
	document: DocumentReference,
	attemptId: string,
	portalToken: string,
): PrepareArgs {
	return prepareArgs(document, {
		attemptId,
		portalToken,
		envelope: envelope(portalToken),
	});
}

async function expectResolutionError(
	operation: Promise<unknown>,
	code: (typeof DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES)[keyof typeof DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES],
) {
	try {
		await operation;
		expect.fail(`Expected document email resolution error ${code}`);
	} catch (error) {
		expect((error as { data?: { code?: string } }).data?.code).toBe(code);
	}
}

async function createInvoice(
	adminA: Awaited<ReturnType<typeof setup>>["adminA"],
	clientId: Id<"photographyClients">,
) {
	return await adminA.mutation(api.invoices.create, {
		siteUrl: SITE_A,
		clientId,
		invoiceType: "one-time",
		items: [{ description: "Portrait session", quantity: 1, unitPrice: 250 }],
	});
}

async function prepareInvoice() {
	const fixture = await setup();
	const invoiceId = await createInvoice(fixture.adminA, fixture.clientId);
	const args = prepareArgs({ type: "invoice", id: invoiceId });
	const prepared = await fixture.adminA.mutation(prepareAttempt, args);
	if (prepared.outcome !== "prepared") {
		throw new Error(`Expected a prepared attempt, got ${prepared.outcome}`);
	}
	return { ...fixture, invoiceId, args, prepared };
}

describe("document email attempt preparation", () => {
	test("freezes an authenticated tenant envelope, portal capability, and provider key", async () => {
		const { t, adminA, adminB, invoiceId, args, prepared, clientId } = await prepareInvoice();

		expect(prepared.outcome).toBe("prepared");
		expect(prepared.attempt).toMatchObject({
			protocolVersion: 1,
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			document: { type: "invoice", id: invoiceId },
			documentKey: `invoice:${invoiceId}`,
			open: true,
			providerRetryBlocked: false,
			clientId,
			portalUrl: `https://${SITE_A}/portal/${PORTAL_TOKEN}`,
			envelope: args.envelope,
			providerIdempotencyKey: `document-email-v1/invoice/${invoiceId}/${ATTEMPT_ID}`,
			providerTags: [{ name: "document_attempt", value: ATTEMPT_ID }],
			status: "prepared",
			claimCount: 0,
		});

		await expect(t.query(getAttempt, { siteUrl: SITE_A, attemptId: ATTEMPT_ID })).rejects.toThrow(
			"Not authenticated",
		);
		await expect(
			adminB.query(getAttempt, { siteUrl: SITE_A, attemptId: ATTEMPT_ID }),
		).rejects.toThrow(/Not authorized/);
		await expect(
			adminA.query(getAttempt, { siteUrl: SITE_A, attemptId: ATTEMPT_ID }),
		).resolves.toMatchObject({ _id: prepared.attempt._id, envelope: args.envelope });

		const portal = await t.run(
			async (ctx) =>
				await ctx.db
					.query("portalTokens")
					.withIndex("by_token", (q) => q.eq("token", PORTAL_TOKEN))
					.unique(),
		);
		expect(portal).toMatchObject({
			_id: prepared.attempt.portalTokenId,
			siteUrl: SITE_A,
			type: "invoice",
			documentId: invoiceId,
			clientId,
			used: false,
		});
	});

	test("binds a quote email portal to the quote's exclusive UTC validity boundary", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"));
		const { t, adminA, clientId } = await setup();
		const quoteId = await adminA.mutation(api.quotes.create, {
			siteUrl: SITE_A,
			clientId,
			packages: [{ name: "Portrait", price: 250 }],
			validUntil: "2026-09-03",
		});
		const prepared = await adminA.mutation(
			prepareAttempt,
			prepareArgs({ type: "quote", id: quoteId }),
		);
		if (prepared.outcome !== "prepared") {
			throw new Error(`Expected a prepared attempt, got ${prepared.outcome}`);
		}
		const expectedExpiry = Date.UTC(2026, 8, 4);
		expect(prepared.attempt).toMatchObject({
			document: { type: "quote", id: quoteId },
			portalExpiresAt: expectedExpiry,
		});
		expect(prepared.attempt).not.toHaveProperty("requestedPortalExpiresAt");
		await expect(
			adminA.mutation(prepareAttempt, prepareArgs({ type: "quote", id: quoteId })),
		).resolves.toMatchObject({ outcome: "replay", attempt: { _id: prepared.attempt._id } });
		await expect(
			t.run((ctx) => ctx.db.get(prepared.attempt.portalTokenId)),
		).resolves.toMatchObject({ expiresAt: expectedExpiry });
	});

	test("rejects terminal document states transactionally before creating an attempt or portal", async () => {
		const { t, adminA, clientId } = await setup();
		const invoiceId = await createInvoice(adminA, clientId);
		const quoteId = await adminA.mutation(api.quotes.create, {
			siteUrl: SITE_A,
			clientId,
			packages: [{ name: "Portrait", price: 250 }],
		});
		const contractId = await adminA.mutation(api.contracts.create, {
			siteUrl: SITE_A,
			clientId,
			title: "Portrait agreement",
			body: "Terms",
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(invoiceId, { status: "paid" });
			await ctx.db.patch(quoteId, { status: "accepted" });
			await ctx.db.patch(contractId, { status: "signed" });
		});

		for (const document of [
			{ type: "invoice" as const, id: invoiceId },
			{ type: "quote" as const, id: quoteId },
			{ type: "contract" as const, id: contractId },
		]) {
			await expect(
				adminA.mutation(prepareAttempt, prepareArgs(document)),
			).resolves.toEqual({ outcome: "rejected", reason: "document_not_sendable" });
		}

		await expect(
			t.run(async (ctx) => ({
				attempts: await ctx.db.query("documentEmailAttempts").take(1),
				portals: await ctx.db.query("portalTokens").take(1),
			})),
		).resolves.toEqual({ attempts: [], portals: [] });
	});

	test("rechecks document status after composition and blocks partial or canceled invoices", async () => {
		const { t, adminA, clientId } = await setup();
		const quoteId = await adminA.mutation(api.quotes.create, {
			siteUrl: SITE_A,
			clientId,
			packages: [{ name: "Portrait", price: 250 }],
		});
		const frozenArgs = prepareArgs({ type: "quote", id: quoteId });
		await t.run((ctx) => ctx.db.patch(quoteId, { status: "declined" }));
		await expect(adminA.mutation(prepareAttempt, frozenArgs)).resolves.toEqual({
			outcome: "rejected",
			reason: "document_not_sendable",
		});

		const invoiceId = await createInvoice(adminA, clientId);
		await t.run((ctx) => ctx.db.patch(invoiceId, { status: "partial" }));
		await expect(
			adminA.mutation(prepareAttempt, prepareArgs({ type: "invoice", id: invoiceId })),
		).resolves.toEqual({ outcome: "rejected", reason: "document_not_sendable" });
		await t.run((ctx) => ctx.db.patch(invoiceId, { status: "canceled" }));
		await expect(
			adminA.mutation(prepareAttempt, prepareArgs({ type: "invoice", id: invoiceId })),
		).resolves.toEqual({ outcome: "rejected", reason: "document_not_sendable" });
	});

	test("replays only the exact frozen request and rejects token reuse", async () => {
		const { adminA, clientId, invoiceId, args, prepared } = await prepareInvoice();

		await expect(adminA.mutation(prepareAttempt, args)).resolves.toMatchObject({
			outcome: "replay",
			attempt: { _id: prepared.attempt._id },
		});
		await expect(
			adminA.mutation(prepareAttempt, {
				...args,
				envelope: { ...args.envelope, subject: "Changed subject" },
			}),
		).resolves.toEqual({ outcome: "rejected", reason: "attempt_conflict" });
		await expect(
			adminA.mutation(
				prepareAttempt,
				prepareArgs({ type: "invoice", id: invoiceId }, { attemptId: SECOND_ATTEMPT_ID }),
			),
		).resolves.toMatchObject({
			outcome: "blocked",
			attempt: { attemptId: ATTEMPT_ID, _id: prepared.attempt._id },
		});

		const otherInvoiceId = await createInvoice(adminA, clientId);
		await expect(
			adminA.mutation(
				prepareAttempt,
				prepareArgs(
					{ type: "invoice", id: otherInvoiceId },
					{ attemptId: SECOND_ATTEMPT_ID },
				),
			),
		).resolves.toEqual({ outcome: "rejected", reason: "portal_token_conflict" });
	});

	test("requires canonical UUIDs, the exact tenant origin, and the linked client recipient", async () => {
		const { adminA, clientId } = await setup();
		const invoiceId = await createInvoice(adminA, clientId);
		const document = { type: "invoice" as const, id: invoiceId };

		await expect(
			adminA.mutation(prepareAttempt, prepareArgs(document, { attemptId: "retry-1" })),
		).resolves.toEqual({ outcome: "rejected", reason: "invalid_request" });
		await expect(
			adminA.mutation(
				prepareAttempt,
				prepareArgs(document, { portalOrigin: `https://${SITE_A}/` }),
			),
		).resolves.toEqual({ outcome: "rejected", reason: "invalid_request" });
		await expect(
			adminA.mutation(
				prepareAttempt,
				prepareArgs(document, {
					envelope: { ...envelope(), to: "someone-else@example.com" },
				}),
			),
		).resolves.toEqual({ outcome: "rejected", reason: "message_invalid" });
	});

	test("concurrent different attempt UUIDs converge on one open attempt and portal", async () => {
		const { t, adminA, clientId } = await setup();
		const invoiceId = await createInvoice(adminA, clientId);
		const document = { type: "invoice" as const, id: invoiceId };
		const [first, second] = await Promise.all([
			adminA.mutation(prepareAttempt, prepareArgs(document)),
			adminA.mutation(
				prepareAttempt,
				alternatePrepareArgs(document, SECOND_ATTEMPT_ID, SECOND_PORTAL_TOKEN),
			),
		]);

		const prepared = [first, second].find((result) => result.outcome === "prepared");
		const blocked = [first, second].find((result) => result.outcome === "blocked");
		expect(prepared?.outcome).toBe("prepared");
		expect(blocked?.outcome).toBe("blocked");
		if (!prepared || prepared.outcome !== "prepared" || !blocked || blocked.outcome !== "blocked") {
			throw new Error("Expected one prepared result and one blocked adoption");
		}
		expect(blocked.attempt._id).toBe(prepared.attempt._id);

		const rows = await t.run(async (ctx) => ({
			attempts: await ctx.db.query("documentEmailAttempts").collect(),
			portals: await ctx.db.query("portalTokens").collect(),
		}));
		expect(rows.attempts).toHaveLength(1);
		expect(rows.portals).toHaveLength(1);
		expect(rows.attempts[0]).toMatchObject({ open: true, documentKey: `invoice:${invoiceId}` });
		await expect(
			adminA.query(getOpenRecoveryByDocument, { siteUrl: SITE_A, document }),
		).resolves.toMatchObject({
			attemptId: prepared.attempt.attemptId,
			status: "prepared",
		});
	});

	test("returns a browser-safe recovery projection without replay secrets", async () => {
		const { adminA, args, prepared } = await prepareInvoice();
		const recovery = await adminA.query(getRecovery, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
		});

		expect(recovery).toMatchObject({
			protocolVersion: 1,
			attemptId: ATTEMPT_ID,
			document: prepared.attempt.document,
			status: "prepared",
			recipient: CLIENT_EMAIL,
			subject: args.envelope.subject,
			claimCount: 0,
			portalExpired: false,
			canRetry: true,
			canFinalizeAcceptance: false,
			canRecordAcceptance: false,
			canResolveNotAccepted: true,
		});
		for (const privateField of [
			"envelope",
			"portalUrl",
			"portalTokenId",
			"providerIdempotencyKey",
			"providerTags",
			"claimId",
			"emailLogId",
			"activityLogId",
			"resolvedByTokenIdentifier",
		]) {
			expect(recovery).not.toHaveProperty(privateField);
		}
		const serialized = JSON.stringify(recovery);
		expect(serialized).not.toContain(PORTAL_TOKEN);
		expect(serialized).not.toContain(args.envelope.text);
		expect(serialized).not.toContain(prepared.attempt.providerIdempotencyKey);
	});

	test("discovers only the tenant's sanitized open recovery across active states", async () => {
		const { t, adminA, adminB, clientId } = await setup();
		const invoiceId = await createInvoice(adminA, clientId);
		const document = { type: "invoice" as const, id: invoiceId };
		const queryArgs = { siteUrl: SITE_A, document };

		await expect(t.query(getOpenRecoveryByDocument, queryArgs)).rejects.toThrow(
			"Not authenticated",
		);
		await expect(adminB.query(getOpenRecoveryByDocument, queryArgs)).rejects.toThrow(
			/Not authorized/,
		);
		await expect(adminA.query(getOpenRecoveryByDocument, queryArgs)).resolves.toBeNull();

		const prepared = await adminA.mutation(prepareAttempt, prepareArgs(document));
		if (prepared.outcome !== "prepared") throw new Error("Expected prepared attempt");
		await expect(
			adminB.query(getOpenRecoveryByDocument, { siteUrl: SITE_B, document }),
		).resolves.toBeNull();
		await expect(adminA.query(getOpenRecoveryByDocument, queryArgs)).resolves.toMatchObject({
			attemptId: ATTEMPT_ID,
			document,
			status: "prepared",
			canRetry: true,
		});
		await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
		});
		await expect(adminA.query(getOpenRecoveryByDocument, queryArgs)).resolves.toMatchObject({
			attemptId: ATTEMPT_ID,
			status: "claimed",
			canRetry: false,
		});
		await adminA.mutation(failAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
			disposition: "uncertain",
			error: "Provider response timed out",
		});
		const recovery = await adminA.query(getOpenRecoveryByDocument, queryArgs);
		expect(recovery).toMatchObject({
			attemptId: ATTEMPT_ID,
			status: "uncertain",
			canRetry: true,
		});
		const serialized = JSON.stringify(recovery);
		for (const forbidden of [PORTAL_TOKEN, prepared.attempt.portalUrl, prepared.attempt.envelope.html]) {
			expect(serialized).not.toContain(forbidden);
		}
	});

	test("fails closed when an indexed open row carries a terminal status", async () => {
		const { t, adminA, invoiceId, prepared } = await prepareInvoice();
		const document = { type: "invoice" as const, id: invoiceId };
		await t.run((ctx) => ctx.db.patch(prepared.attempt._id, { status: "sent" }));

		await expect(
			adminA.query(getOpenRecoveryByDocument, { siteUrl: SITE_A, document }),
		).resolves.toBeNull();
	});

	test.each(["sent", "failed", "resolved_not_sent"] as const)(
		"excludes terminal %s attempts from document recovery discovery",
		async (terminalStatus) => {
			const { adminA, invoiceId } = await prepareInvoice();
			const document = { type: "invoice" as const, id: invoiceId };
			if (terminalStatus === "resolved_not_sent") {
				await adminA.mutation(resolveAttempt, {
					siteUrl: SITE_A,
					attemptId: ATTEMPT_ID,
					expectedDocument: document,
					resolution: {
						kind: "not_accepted",
						confirmation: "NOT ACCEPTED",
						note: "No provider request was started.",
					},
				});
			} else {
				await adminA.mutation(claimAttempt, {
					siteUrl: SITE_A,
					attemptId: ATTEMPT_ID,
					claimId: CLAIM_ID,
				});
				if (terminalStatus === "sent") {
					await adminA.mutation(completeAttempt, {
						siteUrl: SITE_A,
						attemptId: ATTEMPT_ID,
						claimId: CLAIM_ID,
						providerMessageId: "re_terminal_discovery",
					});
				} else {
					await adminA.mutation(failAttempt, {
						siteUrl: SITE_A,
						attemptId: ATTEMPT_ID,
						claimId: CLAIM_ID,
						disposition: "failed",
						error: "Provider rejected the request",
					});
				}
			}

			await expect(
				adminA.query(getOpenRecoveryByDocument, { siteUrl: SITE_A, document }),
			).resolves.toBeNull();
		},
	);

	test("caps a 65th document capability without capping gallery capabilities", async () => {
		const { t, adminA, clientId } = await setup();
		const invoiceId = await createInvoice(adminA, clientId);
		const galleryId = await adminA.mutation(api.galleries.create, {
			siteUrl: SITE_A,
			clientId,
			name: "Capacity gallery",
			slug: "capacity-gallery",
			downloadEnabled: true,
			favoritesEnabled: true,
		});
		await t.run(async (ctx) => {
			for (
				let index = 0;
				index < DOCUMENT_EMAIL_MAX_PORTAL_CAPABILITIES_PER_DOCUMENT;
				index += 1
			) {
				await ctx.db.insert("portalTokens", {
					token: `capacity-existing-${index}`,
					siteUrl: SITE_A,
					type: "invoice",
					documentId: invoiceId,
					clientId,
					used: false,
				});
				await ctx.db.insert("portalTokens", {
					token: `gallery-capacity-existing-${index}`,
					siteUrl: SITE_A,
					type: "gallery",
					documentId: galleryId,
					clientId,
					used: false,
				});
			}
		});
		const galleryTokens = await Promise.all([
			adminA.mutation(api.portal.createToken, {
				siteUrl: SITE_A,
				type: "gallery",
				documentId: galleryId,
				clientId,
			}),
			adminA.mutation(api.portal.createToken, {
				siteUrl: SITE_A,
				type: "gallery",
				documentId: galleryId,
				clientId,
			}),
		]);
		for (const token of galleryTokens) {
			await expect(t.query(api.portal.getByToken, { token })).resolves.toMatchObject({
				expired: false,
				token: { type: "gallery", documentId: galleryId, used: false },
				document: { _id: galleryId },
			});
		}

		await expect(
			adminA.mutation(prepareAttempt, prepareArgs({ type: "invoice", id: invoiceId })),
		).resolves.toEqual({ outcome: "rejected", reason: "portal_unavailable" });
		await expect(
			adminA.mutation(api.portal.createToken, {
				siteUrl: SITE_A,
				type: "invoice",
				documentId: invoiceId,
				clientId,
			}),
		).rejects.toThrow("Portal capability limit reached");

		const state = await t.run(async (ctx) => ({
			documentCapabilities: await ctx.db
				.query("portalTokens")
				.withIndex("by_documentId", (q) => q.eq("documentId", invoiceId))
				.collect(),
			galleryCapabilities: await ctx.db
				.query("portalTokens")
				.withIndex("by_documentId", (q) => q.eq("documentId", galleryId))
				.collect(),
			attempts: await ctx.db.query("documentEmailAttempts").collect(),
		}));
		expect(state.documentCapabilities).toHaveLength(
			DOCUMENT_EMAIL_MAX_PORTAL_CAPABILITIES_PER_DOCUMENT,
		);
		expect(state.galleryCapabilities).toHaveLength(
			DOCUMENT_EMAIL_MAX_PORTAL_CAPABILITIES_PER_DOCUMENT + 2,
		);
		expect(state.attempts).toHaveLength(0);
	});
});

describe("document email delivery lifecycle", () => {
	test("claims once and gives exact-claim replays the frozen send payload", async () => {
		const { adminA, prepared } = await prepareInvoice();
		const claimed = await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
		});

		expect(claimed).toMatchObject({
			outcome: "claimed",
			attempt: {
				_id: prepared.attempt._id,
				status: "claimed",
				claimCount: 1,
				claimId: CLAIM_ID,
				envelope: prepared.attempt.envelope,
				providerIdempotencyKey: prepared.attempt.providerIdempotencyKey,
			},
		});
		await expect(
			adminA.mutation(claimAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: CLAIM_ID,
			}),
		).resolves.toMatchObject({ outcome: "claimed", attempt: { claimCount: 1 } });
		await expect(
			adminA.mutation(claimAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: SECOND_CLAIM_ID,
			}),
		).resolves.toMatchObject({ outcome: "busy", attempt: { claimId: CLAIM_ID } });
	});

	test("refuses provider work when the raw capability range grows to 65", async () => {
		const { t, adminA, invoiceId, clientId, prepared } = await prepareInvoice();
		await t.run(async (ctx) => {
			for (
				let index = 0;
				index < DOCUMENT_EMAIL_MAX_PORTAL_CAPABILITIES_PER_DOCUMENT;
				index += 1
			) {
				await ctx.db.insert("portalTokens", {
					token: `capacity-overflow-${index}`,
					siteUrl: SITE_A,
					type: "invoice",
					documentId: invoiceId,
					clientId,
					used: false,
				});
			}
		});

		await expect(
			adminA.mutation(claimAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: CLAIM_ID,
			}),
		).resolves.toMatchObject({
			outcome: "released",
			attempt: {
				status: "resolved_not_sent",
				open: false,
				providerRetryBlocked: true,
				claimCount: 0,
			},
		});
		await expect(t.run((ctx) => ctx.db.get(prepared.attempt.portalTokenId))).resolves.toMatchObject({
			used: true,
			revokedAt: expect.any(Number),
		});
		expect(await t.run((ctx) => ctx.db.query("emailLog").collect())).toHaveLength(0);
	});

	test("claims and completes with exactly 64 capabilities including the current link", async () => {
		const { t, adminA, invoiceId, clientId, prepared } = await prepareInvoice();
		await t.run(async (ctx) => {
			for (
				let index = 1;
				index < DOCUMENT_EMAIL_MAX_PORTAL_CAPABILITIES_PER_DOCUMENT;
				index += 1
			) {
				await ctx.db.insert("portalTokens", {
					token: `capacity-at-limit-${index}`,
					siteUrl: SITE_A,
					type: "invoice",
					documentId: invoiceId,
					clientId,
					used: false,
				});
			}
		});

		await expect(
			adminA.mutation(claimAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: CLAIM_ID,
			}),
		).resolves.toMatchObject({ outcome: "claimed", attempt: { claimCount: 1 } });
		await expect(
			adminA.mutation(completeAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: CLAIM_ID,
				providerMessageId: "re_capacity_at_limit",
			}),
		).resolves.toMatchObject({ outcome: "sent" });

		const capabilities = await t.run((ctx) =>
			ctx.db
				.query("portalTokens")
				.withIndex("by_documentId", (q) => q.eq("documentId", invoiceId))
				.collect(),
		);
		expect(capabilities).toHaveLength(DOCUMENT_EMAIL_MAX_PORTAL_CAPABILITIES_PER_DOCUMENT);
		expect(capabilities.find((row) => row._id === prepared.attempt.portalTokenId)).toMatchObject({
			used: false,
		});
		const retired = capabilities.filter((row) => row._id !== prepared.attempt.portalTokenId);
		expect(retired).toHaveLength(DOCUMENT_EMAIL_MAX_PORTAL_CAPABILITIES_PER_DOCUMENT - 1);
		for (const capability of retired) {
			expect(capability).toMatchObject({ used: true, revokedAt: expect.any(Number) });
		}
	});

	test("releases an unclaimed attempt when its document becomes terminal before claim", async () => {
		const { t, adminA, invoiceId, prepared } = await prepareInvoice();
		await t.run((ctx) => ctx.db.patch(invoiceId, { status: "paid" }));

		await expect(
			adminA.mutation(claimAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: CLAIM_ID,
			}),
		).resolves.toMatchObject({
			outcome: "released",
			attempt: {
				status: "resolved_not_sent",
				open: false,
				providerRetryBlocked: true,
				claimCount: 0,
			},
		});
		await expect(t.run((ctx) => ctx.db.get(prepared.attempt.portalTokenId))).resolves.toMatchObject({
			used: true,
			revokedAt: expect.any(Number),
		});
		await expect(t.query(api.portal.getByToken, { token: PORTAL_TOKEN })).resolves.toBeNull();
		expect(await t.run((ctx) => ctx.db.query("emailLog").collect())).toHaveLength(0);
	});

	test("refuses an unclaimed send when quote validity is shortened after prepare", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"));
		const { t, adminA, clientId } = await setup();
		const quoteId = await adminA.mutation(api.quotes.create, {
			siteUrl: SITE_A,
			clientId,
			packages: [{ name: "Portrait", price: 250 }],
			validUntil: "2026-09-03",
		});
		const prepared = await adminA.mutation(
			prepareAttempt,
			prepareArgs({ type: "quote", id: quoteId }),
		);
		if (prepared.outcome !== "prepared") throw new Error("Expected prepared quote attempt");
		await t.run((ctx) => ctx.db.patch(quoteId, { validUntil: "2026-08-31" }));

		await expect(
			adminA.mutation(claimAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: CLAIM_ID,
			}),
		).resolves.toMatchObject({
			outcome: "expired",
			attempt: {
				status: "resolved_not_sent",
				open: false,
				providerRetryBlocked: true,
				claimCount: 0,
			},
		});
		await expect(t.run((ctx) => ctx.db.get(prepared.attempt.portalTokenId))).resolves.toMatchObject({
			used: true,
			revokedAt: expect.any(Number),
		});
		await expect(t.query(api.portal.getByToken, { token: PORTAL_TOKEN })).resolves.toBeNull();
	});

	test("permanently blocks provider retry after a prior claim finds a mismatched target", async () => {
		const { t, adminA, invoiceId, otherClientId } = await prepareInvoice();
		await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
		});
		await adminA.mutation(failAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
			disposition: "uncertain",
			error: "Provider response timed out",
		});
		const originalClientId = await t.run(async (ctx) => (await ctx.db.get(invoiceId))?.clientId);
		await t.run((ctx) => ctx.db.patch(invoiceId, { clientId: otherClientId }));

		await expect(
			adminA.mutation(claimAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: SECOND_CLAIM_ID,
			}),
		).resolves.toMatchObject({
			outcome: "uncertain",
			attempt: {
				status: "uncertain",
				open: true,
				providerRetryBlocked: true,
				claimCount: 1,
				claimId: CLAIM_ID,
			},
		});
		if (!originalClientId) throw new Error("Expected original invoice client");
		await t.run((ctx) => ctx.db.patch(invoiceId, { clientId: originalClientId }));

		await expect(
			adminA.mutation(claimAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: THIRD_CLAIM_ID,
			}),
		).resolves.toMatchObject({
			outcome: "uncertain",
			attempt: {
				providerRetryBlocked: true,
				claimCount: 1,
				claimId: CLAIM_ID,
			},
		});
		await expect(
			adminA.query(getRecovery, { siteUrl: SITE_A, attemptId: ATTEMPT_ID }),
		).resolves.toMatchObject({ canRetry: false, canRecordAcceptance: true });
	});

	test("blocks provider retry after a previously claimed portal capability is consumed", async () => {
		const { t, adminA, prepared } = await prepareInvoice();
		await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
		});
		await adminA.mutation(failAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
			disposition: "uncertain",
			error: "Provider response timed out",
		});
		await t.run((ctx) => ctx.db.patch(prepared.attempt.portalTokenId, { used: true }));

		await expect(
			adminA.mutation(claimAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: SECOND_CLAIM_ID,
			}),
		).resolves.toMatchObject({
			outcome: "expired",
			attempt: {
				status: "uncertain",
				providerRetryBlocked: true,
				claimCount: 1,
			},
		});
		await expect(
			adminA.query(getRecovery, { siteUrl: SITE_A, attemptId: ATTEMPT_ID }),
		).resolves.toMatchObject({ canRetry: false });

		await t.run((ctx) => ctx.db.patch(prepared.attempt.portalTokenId, { used: false }));
		await expect(
			adminA.mutation(claimAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: THIRD_CLAIM_ID,
			}),
		).resolves.toMatchObject({
			outcome: "uncertain",
			attempt: { providerRetryBlocked: true, claimCount: 1, claimId: CLAIM_ID },
		});
	});

	test("completes success exactly once and advances only a draft lifecycle", async () => {
		const { t, adminA, invoiceId } = await prepareInvoice();
		await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
		});
		const completed = await adminA.mutation(completeAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
			providerMessageId: "re_provider_1",
		});

		expect(completed).toMatchObject({
			outcome: "sent",
			attempt: {
				status: "sent",
				providerMessageId: "re_provider_1",
				emailLogId: expect.any(String),
				activityLogId: expect.any(String),
			},
		});
		const state = await t.run(async (ctx) => ({
			invoice: await ctx.db.get(invoiceId),
			emails: await ctx.db.query("emailLog").collect(),
			activities: await ctx.db.query("activityLog").collect(),
		}));
		expect(state.invoice).toMatchObject({ status: "sent", sentAt: expect.any(Number) });
		expect(state.emails).toEqual([
			expect.objectContaining({
				_id: completed.attempt.emailLogId,
				type: "invoice",
				relatedId: invoiceId,
				status: "sent",
				resendId: "re_provider_1",
			}),
		]);
		expect(state.activities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					_id: completed.attempt.activityLogId,
					action: "invoice_sent",
					description: expect.stringMatching(/^invoice INV-\d{3} sent$/),
				}),
			]),
		);

		await expect(
			adminA.mutation(completeAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: CLAIM_ID,
				providerMessageId: "re_provider_1",
			}),
		).resolves.toMatchObject({ outcome: "replay" });
		await expect(
			adminA.mutation(completeAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: CLAIM_ID,
				providerMessageId: "re_provider_other",
			}),
		).rejects.toThrow(/conflicts with the sent attempt/);
		const afterReplay = await t.run(async (ctx) => ({
			emails: await ctx.db.query("emailLog").collect(),
			activities: await ctx.db.query("activityLog").collect(),
		}));
		expect(afterReplay.emails).toHaveLength(1);
		expect(afterReplay.activities.filter((row) => row.action === "invoice_sent")).toHaveLength(1);
	});

	test("preserves terminal document status and an existing sent timestamp", async () => {
		const { t, adminA, clientId } = await setup();
		const quoteId = await adminA.mutation(api.quotes.create, {
			siteUrl: SITE_A,
			clientId,
			packages: [{ name: "Portrait", price: 250 }],
		});
		const originalSentAt = 1_700_000_000_000;
		await t.run(async (ctx) => {
			await ctx.db.patch(quoteId, { status: "sent", sentAt: originalSentAt });
		});
		await adminA.mutation(
			prepareAttempt,
			prepareArgs(
				{ type: "quote", id: quoteId },
				{ envelope: { ...envelope(), subject: "Your quote" } },
			),
		);
		await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
		});
		await t.run((ctx) => ctx.db.patch(quoteId, { status: "accepted" }));
		await adminA.mutation(completeAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
			providerMessageId: "re_quote_1",
		});

		await expect(t.run((ctx) => ctx.db.get(quoteId))).resolves.toMatchObject({
			status: "accepted",
			sentAt: originalSentAt,
		});
	});

	test("records a definite failure once without changing the document lifecycle", async () => {
		const { t, adminA, invoiceId, prepared } = await prepareInvoice();
		await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
		});
		const failed = await adminA.mutation(failAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
			disposition: "failed",
			error: "Provider rejected the request",
		});
		expect(failed).toMatchObject({
			outcome: "failed",
			attempt: { status: "failed", emailLogId: expect.any(String) },
		});
		await expect(
			adminA.mutation(failAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: CLAIM_ID,
				disposition: "failed",
				error: "Provider rejected the request",
			}),
		).resolves.toMatchObject({ outcome: "replay" });

		const state = await t.run(async (ctx) => ({
			invoice: await ctx.db.get(invoiceId),
			portal: await ctx.db.get(prepared.attempt.portalTokenId),
			emails: await ctx.db.query("emailLog").collect(),
			activities: await ctx.db.query("activityLog").collect(),
		}));
		expect(state.invoice).toMatchObject({ status: "draft" });
		expect(state.invoice).not.toHaveProperty("sentAt");
		expect(state.portal).toMatchObject({ used: true, revokedAt: expect.any(Number) });
		await expect(t.query(api.portal.getByToken, { token: PORTAL_TOKEN })).resolves.toBeNull();
		expect(state.emails).toEqual([
			expect.objectContaining({
				_id: failed.attempt.emailLogId,
				status: "failed",
				error: "Provider rejected the request",
			}),
		]);
		expect(state.activities.filter((row) => row.action === "invoice_sent")).toHaveLength(0);
	});

	test("bounds an expired claim as uncertain and permits exact-claim reconciliation", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"));
		const { adminA } = await prepareInvoice();
		const claimed = await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
		});
		vi.setSystemTime((claimed.attempt.claimExpiresAt ?? Date.now()) + 1);

		await expect(
			adminA.mutation(claimAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: SECOND_CLAIM_ID,
			}),
		).resolves.toMatchObject({
			outcome: "uncertain",
			attempt: { status: "uncertain", claimId: CLAIM_ID, claimCount: 1 },
		});
		await expect(
			adminA.mutation(completeAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: CLAIM_ID,
				providerMessageId: "re_late_success",
			}),
		).resolves.toMatchObject({ outcome: "sent", attempt: { status: "sent" } });
	});

	test("automatically moves an abandoned claim to uncertainty at its fixed lease", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"));
		const { t, adminA } = await prepareInvoice();
		await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
		});

		await t.finishAllScheduledFunctions(vi.runAllTimers);
		await expect(
			adminA.query(getAttempt, { siteUrl: SITE_A, attemptId: ATTEMPT_ID }),
		).resolves.toMatchObject({
			status: "uncertain",
			claimCount: 1,
			claimId: CLAIM_ID,
			failure: expect.stringMatching(/claim expired/),
		});
	});

	test("stores uncertainty without a false failed log and blocks ordinary negative resolution", async () => {
		const { t, adminA } = await prepareInvoice();
		await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
		});
		const uncertain = await adminA.mutation(failAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
			disposition: "uncertain",
			error: "Provider response timed out",
		});
		expect(uncertain).toMatchObject({
			outcome: "uncertain",
			attempt: { status: "uncertain" },
		});
		expect(uncertain.attempt).not.toHaveProperty("emailLogId");
		expect(await t.run((ctx) => ctx.db.query("emailLog").collect())).toHaveLength(0);

		await expect(
			adminA.mutation(failAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: CLAIM_ID,
				disposition: "failed",
				error: "Provider confirmed rejection",
			}),
		).rejects.toThrow("requires audited operator resolution");
		expect(await t.run((ctx) => ctx.db.query("emailLog").collect())).toHaveLength(0);
	});

	test("reclaims an unknown outcome only with the same frozen provider key", async () => {
		const { adminA } = await prepareInvoice();
		const firstClaim = await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
		});
		await adminA.mutation(failAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
			disposition: "uncertain",
			error: "Provider response timed out",
		});

		await expect(
			adminA.mutation(claimAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: SECOND_CLAIM_ID,
			}),
		).resolves.toMatchObject({
			outcome: "claimed",
			attempt: {
				status: "claimed",
				claimId: SECOND_CLAIM_ID,
				claimCount: 2,
				envelope: firstClaim.attempt.envelope,
				providerIdempotencyKey: firstClaim.attempt.providerIdempotencyKey,
			},
		});
	});

	test("does not replay an unknown provider outcome after the safety window or claim cap", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"));
		const { t, adminA } = await prepareInvoice();
		await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
		});
		const uncertain = await adminA.mutation(failAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
			disposition: "uncertain",
			error: "Provider response timed out",
		});

		vi.setSystemTime(
			uncertain.attempt.createdAt + DOCUMENT_EMAIL_RECONCILIATION_WINDOW_MS,
		);
		await expect(
			adminA.mutation(claimAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: SECOND_CLAIM_ID,
			}),
		).resolves.toMatchObject({ outcome: "uncertain", attempt: { claimCount: 1 } });

		vi.setSystemTime(uncertain.attempt.createdAt + 1);
		await t.run(async (ctx) => {
			await ctx.db.patch(uncertain.attempt._id, {
				claimCount: DOCUMENT_EMAIL_MAX_CLAIMS,
			});
		});
		await expect(
			adminA.mutation(claimAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: SECOND_CLAIM_ID,
			}),
		).resolves.toMatchObject({
			outcome: "uncertain",
			attempt: { claimCount: DOCUMENT_EMAIL_MAX_CLAIMS },
		});
	});

	test("distinguishes an expired definitely-unsent attempt from expired prior ambiguity", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"));
		const { adminA, clientId } = await setup();
		const neverClaimedQuoteId = await adminA.mutation(api.quotes.create, {
			siteUrl: SITE_A,
			clientId,
			packages: [{ name: "Never claimed", price: 250 }],
			validUntil: "2026-09-01",
		});
		const uncertainQuoteId = await adminA.mutation(api.quotes.create, {
			siteUrl: SITE_A,
			clientId,
			packages: [{ name: "Uncertain", price: 300 }],
			validUntil: "2026-09-01",
		});
		const neverClaimed = await adminA.mutation(
			prepareAttempt,
			prepareArgs({ type: "quote", id: neverClaimedQuoteId }),
		);
		const priorClaim = await adminA.mutation(
			prepareAttempt,
			alternatePrepareArgs(
				{ type: "quote", id: uncertainQuoteId },
				SECOND_ATTEMPT_ID,
				SECOND_PORTAL_TOKEN,
			),
		);
		expect(neverClaimed.outcome).toBe("prepared");
		expect(priorClaim.outcome).toBe("prepared");
		await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: SECOND_ATTEMPT_ID,
			claimId: CLAIM_ID,
		});
		await adminA.mutation(failAttempt, {
			siteUrl: SITE_A,
			attemptId: SECOND_ATTEMPT_ID,
			claimId: CLAIM_ID,
			disposition: "uncertain",
			error: "Provider response timed out",
		});

		vi.setSystemTime(new Date("2026-09-02T00:00:00.000Z"));
		await expect(
			adminA.mutation(claimAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: SECOND_CLAIM_ID,
			}),
		).resolves.toMatchObject({
			outcome: "expired",
			attempt: { status: "resolved_not_sent", open: false, claimCount: 0 },
		});
		await expect(
			adminA.mutation(claimAttempt, {
				siteUrl: SITE_A,
				attemptId: SECOND_ATTEMPT_ID,
				claimId: SECOND_CLAIM_ID,
			}),
		).resolves.toMatchObject({
			outcome: "expired",
			attempt: {
				status: "uncertain",
				open: true,
				providerRetryBlocked: true,
				claimCount: 1,
			},
		});

		await expect(
			adminA.query(getRecovery, { siteUrl: SITE_A, attemptId: ATTEMPT_ID }),
		).resolves.toMatchObject({
			status: "resolved_not_sent",
			portalExpired: true,
			canRetry: false,
		});
		await expect(
			adminA.query(getRecovery, {
				siteUrl: SITE_A,
				attemptId: SECOND_ATTEMPT_ID,
			}),
		).resolves.toMatchObject({
			status: "uncertain",
			portalExpired: true,
			canRetry: false,
			canRecordAcceptance: true,
		});
	});

	test("preserves a known provider acceptance through uncertain completion and finalizes without another send", async () => {
		const { t, adminA } = await prepareInvoice();
		await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
		});
		const uncertain = await adminA.mutation(failAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
			disposition: "uncertain",
			error: "Delivery completion response was lost",
			providerMessageId: "re_provider_accepted",
		});

		expect(uncertain).toMatchObject({
			outcome: "uncertain",
			attempt: {
				status: "uncertain",
				claimId: CLAIM_ID,
				providerMessageId: "re_provider_accepted",
			},
		});
		expect(await t.run((ctx) => ctx.db.query("emailLog").collect())).toHaveLength(0);

		await expect(
			adminA.mutation(completeAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: CLAIM_ID,
				providerMessageId: "re_provider_accepted",
			}),
		).resolves.toMatchObject({
			outcome: "sent",
			attempt: {
				status: "sent",
				providerMessageId: "re_provider_accepted",
			},
		});
		expect(await t.run((ctx) => ctx.db.query("emailLog").collect())).toEqual([
			expect.objectContaining({
				status: "sent",
				resendId: "re_provider_accepted",
			}),
		]);
	});
});

describe("document email operator recovery and portal rotation", () => {
	test("does not advertise or accept operator-entered provider evidence during a live claim", async () => {
		const { t, adminA, invoiceId } = await prepareInvoice();
		await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
		});

		await expect(
			adminA.query(getRecovery, { siteUrl: SITE_A, attemptId: ATTEMPT_ID }),
		).resolves.toMatchObject({
			status: "claimed",
			canRetry: false,
			canRecordAcceptance: false,
			canResolveNotAccepted: false,
		});
		await expectResolutionError(
			adminA.mutation(resolveAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				expectedDocument: { type: "invoice", id: invoiceId },
				resolution: { kind: "accepted", providerMessageId: "re_manual_live" },
			}),
			DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES.liveClaim,
		);

		await adminA.mutation(failAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
			disposition: "uncertain",
			error: "Provider response timed out",
		});
		await expect(
			adminA.mutation(resolveAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				expectedDocument: { type: "invoice", id: invoiceId },
				resolution: { kind: "accepted", providerMessageId: "re_manual_live" },
			}),
		).resolves.toMatchObject({ outcome: "sent", recovery: { status: "sent" } });
		expect(await t.run((ctx) => ctx.db.query("emailLog").collect())).toHaveLength(1);
	});

	test("finalizes stored provider acceptance exactly once and replays without duplicate logs", async () => {
		const { t, adminA, invoiceId } = await prepareInvoice();
		await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
		});
		await adminA.mutation(failAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
			disposition: "uncertain",
			error: "Completion response was lost",
			providerMessageId: "re_stored_acceptance",
		});
		await expect(
			adminA.query(getRecovery, { siteUrl: SITE_A, attemptId: ATTEMPT_ID }),
		).resolves.toMatchObject({
			status: "uncertain",
			providerMessageId: "re_stored_acceptance",
			canRetry: false,
			canFinalizeAcceptance: true,
			canRecordAcceptance: false,
		});

		const resolutionArgs = {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			expectedDocument: { type: "invoice" as const, id: invoiceId },
			resolution: { kind: "accepted" as const },
		};
		await expect(adminA.mutation(resolveAttempt, resolutionArgs)).resolves.toMatchObject({
			outcome: "sent",
			recovery: { status: "sent", providerMessageId: "re_stored_acceptance" },
		});
		await expect(adminA.mutation(resolveAttempt, resolutionArgs)).resolves.toMatchObject({
			outcome: "replay",
			recovery: { status: "sent", providerMessageId: "re_stored_acceptance" },
		});
		await expectResolutionError(
			adminA.mutation(resolveAttempt, {
				...resolutionArgs,
				resolution: { kind: "accepted", providerMessageId: "re_conflicting" },
			}),
			DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES.resolutionConflict,
		);

		const state = await t.run(async (ctx) => ({
			attempt: await ctx.db
				.query("documentEmailAttempts")
				.withIndex("by_siteUrl_and_attemptId", (q) =>
					q.eq("siteUrl", SITE_A).eq("attemptId", ATTEMPT_ID),
				)
				.unique(),
			emails: await ctx.db.query("emailLog").collect(),
			activities: await ctx.db.query("activityLog").collect(),
		}));
		expect(state.attempt?.resolution).toMatchObject({
			kind: "accepted",
			source: "stored_provider_id",
			priorStatus: "uncertain",
			priorClaimCount: 1,
		});
		expect(state.emails.filter((row) => row.status === "sent")).toHaveLength(1);
		expect(state.activities.filter((row) => row.action === "invoice_sent")).toHaveLength(1);
	});

	test("enforces the delayed negative boundary and replays one audited release", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"));
		const { t, adminA, adminB, invoiceId, prepared } = await prepareInvoice();
		await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
		});
		await adminA.mutation(failAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
			disposition: "uncertain",
			error: "Provider response timed out",
		});
		const resolutionArgs = {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			expectedDocument: { type: "invoice" as const, id: invoiceId },
			resolution: {
				kind: "not_accepted" as const,
				confirmation: "NOT ACCEPTED" as const,
				note: "Provider dashboard confirms no accepted request.",
			},
		};

		await expectResolutionError(
			adminB.mutation(resolveAttempt, { ...resolutionArgs, siteUrl: SITE_B }),
			DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES.notFound,
		);
		vi.setSystemTime(
			prepared.attempt.createdAt + DOCUMENT_EMAIL_NEGATIVE_RESOLUTION_DELAY_MS - 1,
		);
		await expectResolutionError(
			adminA.mutation(resolveAttempt, resolutionArgs),
			DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES.notEligible,
		);
		vi.setSystemTime(
			prepared.attempt.createdAt + DOCUMENT_EMAIL_NEGATIVE_RESOLUTION_DELAY_MS,
		);
		await expect(adminA.mutation(resolveAttempt, resolutionArgs)).resolves.toMatchObject({
			outcome: "released",
			recovery: {
				status: "resolved_not_sent",
				canRetry: false,
				canResolveNotAccepted: false,
			},
		});
		await expect(adminA.mutation(resolveAttempt, resolutionArgs)).resolves.toMatchObject({
			outcome: "replay",
			recovery: { status: "resolved_not_sent" },
		});
		await expectResolutionError(
			adminA.mutation(resolveAttempt, {
				...resolutionArgs,
				resolution: { ...resolutionArgs.resolution, note: "Different operator finding." },
			}),
			DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES.resolutionConflict,
		);

		const state = await t.run(async (ctx) => ({
			portal: await ctx.db.get(prepared.attempt.portalTokenId),
			emails: await ctx.db.query("emailLog").collect(),
			activities: await ctx.db.query("activityLog").collect(),
		}));
		expect(state.portal).toMatchObject({ used: true, revokedAt: expect.any(Number) });
		await expect(t.query(api.portal.getByToken, { token: PORTAL_TOKEN })).resolves.toBeNull();
		expect(state.emails).toHaveLength(0);
		expect(
			state.activities.filter((row) => row.action === "invoice_email_not_accepted"),
		).toHaveLength(1);
	});

	test("starts the negative-resolution safety delay at the latest provider claim", async () => {
		vi.useFakeTimers();
		const createdAt = new Date("2026-09-01T00:00:00.000Z").getTime();
		vi.setSystemTime(createdAt);
		const { adminA, invoiceId } = await prepareInvoice();
		const claimedAt = createdAt + 22 * 60 * 60 * 1000;
		vi.setSystemTime(claimedAt);
		await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
		});
		await adminA.mutation(failAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
			disposition: "uncertain",
			error: "Provider response timed out",
		});
		const resolutionArgs = {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			expectedDocument: { type: "invoice" as const, id: invoiceId },
			resolution: {
				kind: "not_accepted" as const,
				confirmation: "NOT ACCEPTED" as const,
				note: "Provider dashboard confirms no accepted request.",
			},
		};
		const safeAt = claimedAt + DOCUMENT_EMAIL_NEGATIVE_RESOLUTION_DELAY_MS;

		await expect(
			adminA.query(getRecovery, { siteUrl: SITE_A, attemptId: ATTEMPT_ID }),
		).resolves.toMatchObject({ resolveNotAcceptedAt: safeAt });
		vi.setSystemTime(createdAt + DOCUMENT_EMAIL_NEGATIVE_RESOLUTION_DELAY_MS);
		await expectResolutionError(
			adminA.mutation(resolveAttempt, resolutionArgs),
			DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES.notEligible,
		);
		vi.setSystemTime(safeAt);
		await expect(adminA.mutation(resolveAttempt, resolutionArgs)).resolves.toMatchObject({
			outcome: "released",
			recovery: { status: "resolved_not_sent" },
		});
	});

	test("revokes only the released replacement portal and permits a new attempt", async () => {
		const { t, adminA, clientId } = await setup();
		const quoteId = await adminA.mutation(api.quotes.create, {
			siteUrl: SITE_A,
			clientId,
			packages: [{ name: "Portrait", price: 250 }],
		});
		const document = { type: "quote" as const, id: quoteId };
		const first = await adminA.mutation(prepareAttempt, prepareArgs(document));
		if (first.outcome !== "prepared") throw new Error("Expected first attempt");
		await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
		});
		await adminA.mutation(completeAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
			providerMessageId: "re_initial_quote",
		});

		const replacement = await adminA.mutation(
			prepareAttempt,
			alternatePrepareArgs(document, SECOND_ATTEMPT_ID, SECOND_PORTAL_TOKEN),
		);
		if (replacement.outcome !== "prepared") throw new Error("Expected replacement attempt");
		await adminA.mutation(resolveAttempt, {
			siteUrl: SITE_A,
			attemptId: SECOND_ATTEMPT_ID,
			expectedDocument: document,
			resolution: {
				kind: "not_accepted",
				confirmation: "NOT ACCEPTED",
				note: "No provider request was started.",
			},
		});

		const portals = await t.run(async (ctx) => ({
			prior: await ctx.db.get(first.attempt.portalTokenId),
			replacement: await ctx.db.get(replacement.attempt.portalTokenId),
		}));
		expect(portals.prior).toMatchObject({ used: false });
		expect(portals.prior).not.toHaveProperty("revokedAt");
		expect(portals.replacement).toMatchObject({
			used: true,
			revokedAt: expect.any(Number),
		});
		await expect(t.query(api.portal.getByToken, { token: PORTAL_TOKEN })).resolves.toMatchObject({
			expired: false,
			token: { type: "quote", used: false },
		});
		await expect(
			t.query(api.portal.getByToken, { token: SECOND_PORTAL_TOKEN }),
		).resolves.toBeNull();
		await expect(
			t.mutation(api.portal.acceptQuote, { token: SECOND_PORTAL_TOKEN }),
		).rejects.toThrow("Invalid token");

		await expect(
			adminA.mutation(
				prepareAttempt,
				alternatePrepareArgs(document, THIRD_ATTEMPT_ID, THIRD_PORTAL_TOKEN),
			),
		).resolves.toMatchObject({ outcome: "prepared", attempt: { open: true } });
	});

	test("preserves a prior sent portal through replacement failure and retires it only after acceptance", async () => {
		const { t, adminA, invoiceId, prepared: first } = await prepareInvoice();
		const document = { type: "invoice" as const, id: invoiceId };
		await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
		});
		await adminA.mutation(completeAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
			providerMessageId: "re_initial_invoice",
		});

		const failedReplacement = await adminA.mutation(
			prepareAttempt,
			alternatePrepareArgs(document, SECOND_ATTEMPT_ID, SECOND_PORTAL_TOKEN),
		);
		if (failedReplacement.outcome !== "prepared") {
			throw new Error("Expected failed replacement attempt");
		}
		await expect(t.run((ctx) => ctx.db.get(first.attempt.portalTokenId))).resolves.toMatchObject({
			used: false,
		});
		await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: SECOND_ATTEMPT_ID,
			claimId: SECOND_CLAIM_ID,
		});
		await adminA.mutation(failAttempt, {
			siteUrl: SITE_A,
			attemptId: SECOND_ATTEMPT_ID,
			claimId: SECOND_CLAIM_ID,
			disposition: "failed",
			error: "Provider rejected the replacement",
		});
		await expect(
			t.run(async (ctx) => ({
				prior: await ctx.db.get(first.attempt.portalTokenId),
				replacement: await ctx.db.get(failedReplacement.attempt.portalTokenId),
			})),
		).resolves.toMatchObject({
			prior: { used: false },
			replacement: { used: true, revokedAt: expect.any(Number) },
		});
		await expect(t.query(api.portal.getByToken, { token: PORTAL_TOKEN })).resolves.toMatchObject({
			expired: false,
			token: { type: "invoice", used: false },
		});
		await expect(
			t.query(api.portal.getByToken, { token: SECOND_PORTAL_TOKEN }),
		).resolves.toBeNull();

		const acceptedReplacement = await adminA.mutation(
			prepareAttempt,
			alternatePrepareArgs(document, THIRD_ATTEMPT_ID, THIRD_PORTAL_TOKEN),
		);
		if (acceptedReplacement.outcome !== "prepared") {
			throw new Error("Expected accepted replacement attempt");
		}
		await expect(t.run((ctx) => ctx.db.get(first.attempt.portalTokenId))).resolves.toMatchObject({
			used: false,
		});
		await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: THIRD_ATTEMPT_ID,
			claimId: THIRD_CLAIM_ID,
		});
		await adminA.mutation(completeAttempt, {
			siteUrl: SITE_A,
			attemptId: THIRD_ATTEMPT_ID,
			claimId: THIRD_CLAIM_ID,
			providerMessageId: "re_accepted_replacement",
		});
		await expect(
			t.run(async (ctx) => ({
				prior: await ctx.db.get(first.attempt.portalTokenId),
				current: await ctx.db.get(acceptedReplacement.attempt.portalTokenId),
			})),
		).resolves.toMatchObject({
			prior: { used: true, revokedAt: expect.any(Number) },
			current: { used: false },
		});
		await expect(t.query(api.portal.getByToken, { token: PORTAL_TOKEN })).resolves.toBeNull();
		await expect(
			t.query(api.portal.getByToken, { token: THIRD_PORTAL_TOKEN }),
		).resolves.toMatchObject({
			expired: false,
			token: { type: "invoice", used: false },
		});
	});

	test("retires every exact pre-journal and historical capability only after replacement acceptance", async () => {
		const {
			t,
			adminA,
			invoiceId,
			clientId,
			otherClientId,
		} = await prepareInvoice();
		const document = { type: "invoice" as const, id: invoiceId };
		await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
		});
		await adminA.mutation(completeAttempt, {
			siteUrl: SITE_A,
			attemptId: ATTEMPT_ID,
			claimId: CLAIM_ID,
			providerMessageId: "re_initial_rotation_history",
		});

		const manualTokens = await Promise.all(
			[0, 1, 2].map(() =>
				adminA.mutation(api.portal.createToken, {
					siteUrl: SITE_A,
					type: "invoice",
					documentId: invoiceId,
					clientId,
				}),
			),
		);
		const otherInvoiceId = await createInvoice(adminA, clientId);
		const otherDocumentToken = await adminA.mutation(api.portal.createToken, {
			siteUrl: SITE_A,
			type: "invoice",
			documentId: otherInvoiceId,
			clientId,
		});
		const unrelatedSameRangeTokens = [
			"rotation-other-tenant",
			"rotation-other-type",
			"rotation-other-client",
		];
		await t.run(async (ctx) => {
			await ctx.db.insert("portalTokens", {
				token: unrelatedSameRangeTokens[0],
				siteUrl: SITE_B,
				type: "invoice",
				documentId: invoiceId,
				clientId,
				used: false,
			});
			await ctx.db.insert("portalTokens", {
				token: unrelatedSameRangeTokens[1],
				siteUrl: SITE_A,
				type: "gallery",
				documentId: invoiceId,
				clientId,
				used: false,
			});
			await ctx.db.insert("portalTokens", {
				token: unrelatedSameRangeTokens[2],
				siteUrl: SITE_A,
				type: "invoice",
				documentId: invoiceId,
				clientId: otherClientId,
				used: false,
			});
		});

		const failedReplacement = await adminA.mutation(
			prepareAttempt,
			alternatePrepareArgs(document, SECOND_ATTEMPT_ID, SECOND_PORTAL_TOKEN),
		);
		if (failedReplacement.outcome !== "prepared") {
			throw new Error("Expected failed replacement attempt");
		}
		await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: SECOND_ATTEMPT_ID,
			claimId: SECOND_CLAIM_ID,
		});
		await adminA.mutation(failAttempt, {
			siteUrl: SITE_A,
			attemptId: SECOND_ATTEMPT_ID,
			claimId: SECOND_CLAIM_ID,
			disposition: "failed",
			error: "Provider rejected the replacement",
		});

		const beforeAcceptance = await t.run(async (ctx) => {
			const range = await ctx.db
				.query("portalTokens")
				.withIndex("by_documentId", (q) => q.eq("documentId", invoiceId))
				.collect();
			return {
				range,
				otherDocument: await ctx.db
					.query("portalTokens")
					.withIndex("by_token", (q) => q.eq("token", otherDocumentToken))
					.unique(),
			};
		});
		const stillLiveTokens = [PORTAL_TOKEN, ...manualTokens];
		for (const token of stillLiveTokens) {
			expect(beforeAcceptance.range.find((row) => row.token === token)).toMatchObject({
				used: false,
			});
			expect(beforeAcceptance.range.find((row) => row.token === token)).not.toHaveProperty(
				"revokedAt",
			);
		}
		expect(
			beforeAcceptance.range.find((row) => row.token === SECOND_PORTAL_TOKEN),
		).toMatchObject({ used: true, revokedAt: expect.any(Number) });
		expect(beforeAcceptance.otherDocument).toMatchObject({ used: false });
		await expect(t.query(api.portal.getByToken, { token: manualTokens[0] })).resolves.toMatchObject({
			expired: false,
			token: { type: "invoice", used: false },
		});

		const acceptedReplacement = await adminA.mutation(
			prepareAttempt,
			alternatePrepareArgs(document, THIRD_ATTEMPT_ID, THIRD_PORTAL_TOKEN),
		);
		if (acceptedReplacement.outcome !== "prepared") {
			throw new Error("Expected accepted replacement attempt");
		}
		await adminA.mutation(claimAttempt, {
			siteUrl: SITE_A,
			attemptId: THIRD_ATTEMPT_ID,
			claimId: THIRD_CLAIM_ID,
		});
		await adminA.mutation(completeAttempt, {
			siteUrl: SITE_A,
			attemptId: THIRD_ATTEMPT_ID,
			claimId: THIRD_CLAIM_ID,
			providerMessageId: "re_accepted_rotation_history",
		});

		const afterAcceptance = await t.run(async (ctx) => {
			const range = await ctx.db
				.query("portalTokens")
				.withIndex("by_documentId", (q) => q.eq("documentId", invoiceId))
				.collect();
			return {
				range,
				otherDocument: await ctx.db
					.query("portalTokens")
					.withIndex("by_token", (q) => q.eq("token", otherDocumentToken))
					.unique(),
			};
		});
		for (const token of stillLiveTokens) {
			expect(afterAcceptance.range.find((row) => row.token === token)).toMatchObject({
				used: true,
				revokedAt: expect.any(Number),
			});
			await expect(t.query(api.portal.getByToken, { token })).resolves.toBeNull();
		}
		expect(
			afterAcceptance.range.find((row) => row.token === SECOND_PORTAL_TOKEN),
		).toMatchObject({ used: true, revokedAt: expect.any(Number) });
		expect(afterAcceptance.range.find((row) => row.token === THIRD_PORTAL_TOKEN)).toMatchObject({
			used: false,
		});
		for (const token of unrelatedSameRangeTokens) {
			const row = afterAcceptance.range.find((candidate) => candidate.token === token);
			expect(row).toMatchObject({ used: false });
			expect(row).not.toHaveProperty("revokedAt");
		}
		expect(afterAcceptance.otherDocument).toMatchObject({ used: false });
		expect(afterAcceptance.otherDocument).not.toHaveProperty("revokedAt");
		await expect(
			t.query(api.portal.getByToken, { token: THIRD_PORTAL_TOKEN }),
		).resolves.toMatchObject({
			expired: false,
			token: { type: "invoice", used: false },
		});
	});

	test.each(["missing", "mismatched"] as const)(
		"records accepted provider truth while preserving a %s document lifecycle",
		async (targetState) => {
			const { t, adminA, invoiceId, otherClientId, prepared } = await prepareInvoice();
			await adminA.mutation(claimAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: CLAIM_ID,
			});
			await adminA.mutation(failAttempt, {
				siteUrl: SITE_A,
				attemptId: ATTEMPT_ID,
				claimId: CLAIM_ID,
				disposition: "uncertain",
				error: "Provider acceptance was recorded before completion failed",
				providerMessageId: `re_${targetState}_target`,
			});
			await t.run((ctx) =>
				targetState === "missing"
					? ctx.db.delete(invoiceId)
					: ctx.db.patch(invoiceId, { clientId: otherClientId }),
			);

			await expect(
				adminA.mutation(resolveAttempt, {
					siteUrl: SITE_A,
					attemptId: ATTEMPT_ID,
					expectedDocument: { type: "invoice", id: invoiceId },
					resolution: { kind: "accepted" },
				}),
			).resolves.toMatchObject({
				outcome: "sent",
				recovery: {
					status: "sent",
					providerMessageId: `re_${targetState}_target`,
				},
			});
			const state = await t.run(async (ctx) => ({
				attempt: await ctx.db.get(prepared.attempt._id),
				portal: await ctx.db.get(prepared.attempt.portalTokenId),
				document: await ctx.db.get(invoiceId),
				emails: await ctx.db.query("emailLog").collect(),
			}));
			expect(state.attempt?.resolution).toMatchObject({
				kind: "accepted",
				lifecycle: targetState === "missing" ? "target_missing" : "target_mismatch",
			});
			expect(state.portal).toMatchObject({
				used: true,
				revokedAt: expect.any(Number),
			});
			expect(state.emails).toEqual([
				expect.objectContaining({
					status: "sent",
					resendId: `re_${targetState}_target`,
				}),
			]);
			if (targetState === "missing") {
				expect(state.document).toBeNull();
			} else {
				expect(state.document).toMatchObject({ clientId: otherClientId });
			}
		},
	);
});

describe("portal document ownership hardening", () => {
	test("rejects creating a token for a different client in the same site", async () => {
		const { adminA, clientId, otherClientId } = await setup();
		const invoiceId = await createInvoice(adminA, clientId);

		await expect(
			adminA.mutation(api.portal.createToken, {
				siteUrl: SITE_A,
				type: "invoice",
				documentId: invoiceId,
				clientId: otherClientId,
			}),
		).rejects.toThrow("Document not found");
	});

	test("refuses forged cross-client portal reads and actions", async () => {
		const { t, adminA, clientId, otherClientId } = await setup();
		const quoteId = await adminA.mutation(api.quotes.create, {
			siteUrl: SITE_A,
			clientId,
			packages: [{ name: "Portrait", price: 250 }],
		});
		const forgedToken = SECOND_PORTAL_TOKEN;
		await t.run(async (ctx) => {
			await ctx.db.insert("portalTokens", {
				token: forgedToken,
				siteUrl: SITE_A,
				type: "quote",
				documentId: quoteId,
				clientId: otherClientId,
				used: false,
			});
		});

		await expect(t.query(api.portal.getByToken, { token: forgedToken })).resolves.toBeNull();
		await expect(t.mutation(api.portal.acceptQuote, { token: forgedToken })).rejects.toThrow(
			/does not match its document client/,
		);
		await expect(t.run((ctx) => ctx.db.get(quoteId))).resolves.toMatchObject({
			status: "draft",
		});
	});

	test("keeps terminal quote and contract decisions immutable through fresh portal tokens", async () => {
		const { t, adminA, clientId } = await setup();
		const quoteId = await adminA.mutation(api.quotes.create, {
			siteUrl: SITE_A,
			clientId,
			packages: [{ name: "Portrait", price: 250 }],
		});
		const acceptedAt = 1_700_000_000_000;
		await t.run((ctx) =>
			ctx.db.patch(quoteId, { status: "accepted", acceptedAt }),
		);
		const quoteToken = await adminA.mutation(api.portal.createToken, {
			siteUrl: SITE_A,
			type: "quote",
			documentId: quoteId,
			clientId,
		});

		await expect(
			t.mutation(api.portal.declineQuote, { token: quoteToken }),
		).rejects.toThrow("Quote is no longer awaiting a response");
		await expect(t.run((ctx) => ctx.db.get(quoteId))).resolves.toMatchObject({
			status: "accepted",
			acceptedAt,
		});

		const contractId = await adminA.mutation(api.contracts.create, {
			siteUrl: SITE_A,
			clientId,
			title: "Portrait agreement",
			body: "Terms",
		});
		const signedAt = 1_700_000_100_000;
		await t.run((ctx) =>
			ctx.db.patch(contractId, {
				status: "expired",
				signedAt,
				signedByName: "Original signer",
			}),
		);
		const contractToken = await adminA.mutation(api.portal.createToken, {
			siteUrl: SITE_A,
			type: "contract",
			documentId: contractId,
			clientId,
		});

		await expect(
			t.mutation(api.portal.signContract, {
				token: contractToken,
				signerName: "Replacement signer",
			}),
		).rejects.toThrow("Contract is no longer awaiting a signature");
		await expect(t.run((ctx) => ctx.db.get(contractId))).resolves.toMatchObject({
			status: "expired",
			signedAt,
			signedByName: "Original signer",
		});
	});

	test("shows terminal receipts only through the exact consuming token", async () => {
		const { t, adminA, clientId } = await setup();

		const acceptedQuoteId = await adminA.mutation(api.quotes.create, {
			siteUrl: SITE_A,
			clientId,
			packages: [{ name: "Accepted", price: 250 }],
		});
		await t.run((ctx) => ctx.db.patch(acceptedQuoteId, { status: "sent" }));
		const acceptedByToken = await adminA.mutation(api.portal.createToken, {
			siteUrl: SITE_A,
			type: "quote",
			documentId: acceptedQuoteId,
			clientId,
		});
		const unusedAcceptedToken = await adminA.mutation(api.portal.createToken, {
			siteUrl: SITE_A,
			type: "quote",
			documentId: acceptedQuoteId,
			clientId,
		});
		await t.mutation(api.portal.acceptQuote, { token: acceptedByToken });
		await expect(
			t.query(api.portal.getPublicByToken, { token: acceptedByToken }),
		).resolves.toMatchObject({
			expired: false,
			token: { type: "quote", used: true },
			document: { status: "accepted" },
		});
		await expect(
			t.query(api.portal.getPublicByToken, { token: unusedAcceptedToken }),
		).resolves.toBeNull();
		await expect(
			t.query(api.portal.getByToken, { token: unusedAcceptedToken }),
		).resolves.toBeNull();

		const declinedQuoteId = await adminA.mutation(api.quotes.create, {
			siteUrl: SITE_A,
			clientId,
			packages: [{ name: "Declined", price: 300 }],
		});
		await t.run((ctx) => ctx.db.patch(declinedQuoteId, { status: "sent" }));
		const declinedByToken = await adminA.mutation(api.portal.createToken, {
			siteUrl: SITE_A,
			type: "quote",
			documentId: declinedQuoteId,
			clientId,
		});
		const unusedDeclinedToken = await adminA.mutation(api.portal.createToken, {
			siteUrl: SITE_A,
			type: "quote",
			documentId: declinedQuoteId,
			clientId,
		});
		await t.mutation(api.portal.declineQuote, { token: declinedByToken });
		await expect(
			t.query(api.portal.getPublicByToken, { token: declinedByToken }),
		).resolves.toMatchObject({
			expired: false,
			token: { type: "quote", used: true },
			document: { status: "declined" },
		});
		await expect(
			t.query(api.portal.getPublicByToken, { token: unusedDeclinedToken }),
		).resolves.toBeNull();
		await expect(
			t.query(api.portal.getByToken, { token: unusedDeclinedToken }),
		).resolves.toBeNull();

		const contractId = await adminA.mutation(api.contracts.create, {
			siteUrl: SITE_A,
			clientId,
			title: "Two-token agreement",
			body: "Terms",
		});
		await t.run((ctx) => ctx.db.patch(contractId, { status: "sent" }));
		const signedByToken = await adminA.mutation(api.portal.createToken, {
			siteUrl: SITE_A,
			type: "contract",
			documentId: contractId,
			clientId,
		});
		const unusedContractToken = await adminA.mutation(api.portal.createToken, {
			siteUrl: SITE_A,
			type: "contract",
			documentId: contractId,
			clientId,
		});
		await t.mutation(api.portal.signContract, {
			token: signedByToken,
			signerName: "Exact signer",
		});
		await expect(
			t.query(api.portal.getPublicByToken, { token: signedByToken }),
		).resolves.toMatchObject({
			expired: false,
			token: { type: "contract", used: true },
			document: { status: "signed" },
		});
		await expect(
			t.query(api.portal.getPublicByToken, { token: unusedContractToken }),
		).resolves.toBeNull();
		await expect(
			t.query(api.portal.getByToken, { token: unusedContractToken }),
		).resolves.toBeNull();
	});

	test("replays the same consumed portal action without repeating effects", async () => {
		const { t, adminA, clientId } = await setup();
		const quoteId = await adminA.mutation(api.quotes.create, {
			siteUrl: SITE_A,
			clientId,
			packages: [{ name: "Portrait", price: 250 }],
		});
		await t.run((ctx) => ctx.db.patch(quoteId, { status: "sent" }));
		const legacyAcceptedToken = await adminA.mutation(api.portal.createToken, {
			siteUrl: SITE_A,
			type: "quote",
			documentId: quoteId,
			clientId,
		});
		await adminA.mutation(api.portal.markUsed, { token: legacyAcceptedToken });
		await expect(
			t.query(api.portal.getPublicByToken, { token: legacyAcceptedToken }),
		).resolves.toBeNull();
		const token = await adminA.mutation(api.portal.createToken, {
			siteUrl: SITE_A,
			type: "quote",
			documentId: quoteId,
			clientId,
		});

		await t.mutation(api.portal.acceptQuote, { token });
		await expect(t.mutation(api.portal.acceptQuote, { token })).resolves.toBeNull();
		await expect(t.mutation(api.portal.declineQuote, { token })).rejects.toThrow(
			"Token already used",
		);
		await expect(t.query(api.portal.getPublicByToken, { token })).resolves.toMatchObject({
			expired: false,
			token: { type: "quote", used: true },
			document: { status: "accepted" },
		});
		await expect(
			t.query(api.portal.getPublicByToken, { token: legacyAcceptedToken }),
		).resolves.toBeNull();
		await expect(
			t.mutation(api.portal.acceptQuote, { token: legacyAcceptedToken }),
		).rejects.toThrow("Token already used");

		const state = await t.run(async (ctx) => ({
			quote: await ctx.db.get(quoteId),
			activities: await ctx.db
				.query("activityLog")
				.withIndex("by_siteUrl", (q) => q.eq("siteUrl", SITE_A))
				.take(50),
		}));
		expect(state.quote).toMatchObject({ status: "accepted" });
		expect(
			state.activities.filter((row) => row.action === "quote_accepted"),
		).toHaveLength(1);

		const declinedQuoteId = await adminA.mutation(api.quotes.create, {
			siteUrl: SITE_A,
			clientId,
			packages: [{ name: "Editorial", price: 300 }],
		});
		await t.run((ctx) =>
			ctx.db.patch(declinedQuoteId, { status: "sent" }),
		);
		const declineToken = await adminA.mutation(api.portal.createToken, {
			siteUrl: SITE_A,
			type: "quote",
			documentId: declinedQuoteId,
			clientId,
		});
		await t.mutation(api.portal.declineQuote, { token: declineToken });
		await expect(
			t.mutation(api.portal.declineQuote, { token: declineToken }),
		).resolves.toBeNull();
		await expect(
			t.query(api.portal.getPublicByToken, { token: declineToken }),
		).resolves.toMatchObject({
			expired: false,
			token: { type: "quote", used: true },
			document: { status: "declined" },
		});

		const contractId = await adminA.mutation(api.contracts.create, {
			siteUrl: SITE_A,
			clientId,
			title: "Editorial agreement",
			body: "Terms",
		});
		await t.run((ctx) => ctx.db.patch(contractId, { status: "sent" }));
		const signToken = await adminA.mutation(api.portal.createToken, {
			siteUrl: SITE_A,
			type: "contract",
			documentId: contractId,
			clientId,
		});
		await t.mutation(api.portal.signContract, {
			token: signToken,
			signerName: "  Primary signer  ",
			signerEmail: "  SIGNER@EXAMPLE.COM ",
			signatureData: "  signature-evidence  ",
		});
		await expect(
			t.mutation(api.portal.signContract, {
				token: signToken,
				signerName: "Primary signer",
				signerEmail: "signer@example.com",
				signatureData: "signature-evidence",
			}),
		).resolves.toBeNull();
		await expect(
			t.query(api.portal.getPublicByToken, { token: signToken }),
		).resolves.toMatchObject({
			expired: false,
			token: { type: "contract", used: true },
			document: { status: "signed", signedAt: expect.any(Number) },
		});
		await expect(
			t.mutation(api.portal.signContract, {
				token: signToken,
				signerName: "Changed replay input",
			}),
		).rejects.toThrow("Signature replay does not match the recorded signature");

		const replayState = await t.run(async (ctx) => ({
			quote: await ctx.db.get(declinedQuoteId),
			contract: await ctx.db.get(contractId),
			acceptedPortal: await ctx.db
				.query("portalTokens")
				.withIndex("by_token", (q) => q.eq("token", token))
				.unique(),
			legacyAcceptedPortal: await ctx.db
				.query("portalTokens")
				.withIndex("by_token", (q) => q.eq("token", legacyAcceptedToken))
				.unique(),
			declinedPortal: await ctx.db
				.query("portalTokens")
				.withIndex("by_token", (q) => q.eq("token", declineToken))
				.unique(),
			signedPortal: await ctx.db
				.query("portalTokens")
				.withIndex("by_token", (q) => q.eq("token", signToken))
				.unique(),
			activities: await ctx.db
				.query("activityLog")
				.withIndex("by_siteUrl", (q) => q.eq("siteUrl", SITE_A))
				.take(50),
		}));
		expect(replayState.quote).toMatchObject({ status: "declined" });
		expect(replayState.contract).toMatchObject({
			status: "signed",
			signedByName: "Primary signer",
			signedByEmail: "signer@example.com",
			signatureData: "signature-evidence",
		});
		expect(replayState.acceptedPortal).toMatchObject({
			used: true,
			consumedAction: "quote_accepted",
		});
		expect(replayState.declinedPortal).toMatchObject({
			used: true,
			consumedAction: "quote_declined",
		});
		expect(replayState.signedPortal).toMatchObject({
			used: true,
			consumedAction: "contract_signed",
		});
		for (const consumedPortal of [
			replayState.acceptedPortal,
			replayState.declinedPortal,
			replayState.signedPortal,
		]) {
			expect(consumedPortal).not.toHaveProperty("revokedAt");
		}
		expect(replayState.legacyAcceptedPortal).toMatchObject({ used: true });
		expect(replayState.legacyAcceptedPortal).not.toHaveProperty("consumedAction");
		expect(
			replayState.activities.filter((row) => row.action === "quote_declined"),
		).toHaveLength(1);
		expect(
			replayState.activities.filter((row) => row.action === "contract_signed"),
		).toHaveLength(1);
	});

	test("keeps legacy used-only document capabilities unreadable in every document state", async () => {
		const { t, adminA, clientId } = await setup();

		const paidInvoiceId = await createInvoice(adminA, clientId);
		await t.run((ctx) => ctx.db.patch(paidInvoiceId, { status: "paid" }));
		const paidInvoiceToken = await adminA.mutation(api.portal.createToken, {
			siteUrl: SITE_A,
			type: "invoice",
			documentId: paidInvoiceId,
			clientId,
		});
		await expect(
			t.query(api.portal.getPublicByToken, { token: paidInvoiceToken }),
		).resolves.toMatchObject({
			expired: false,
			token: { type: "invoice", used: false },
			document: { status: "paid" },
		});
		await adminA.mutation(api.portal.markUsed, { token: paidInvoiceToken });
		await expect(
			t.query(api.portal.getPublicByToken, { token: paidInvoiceToken }),
		).resolves.toBeNull();
		await expect(
			t.query(api.portal.getByToken, { token: paidInvoiceToken }),
		).resolves.toBeNull();

		for (const status of ["draft", "sent", "partial", "overdue", "canceled"] as const) {
			const invoiceId = await createInvoice(adminA, clientId);
			await t.run((ctx) => ctx.db.patch(invoiceId, { status }));
			const token = await adminA.mutation(api.portal.createToken, {
				siteUrl: SITE_A,
				type: "invoice",
				documentId: invoiceId,
				clientId,
			});
			await adminA.mutation(api.portal.markUsed, { token });
			await expect(t.query(api.portal.getPublicByToken, { token })).resolves.toBeNull();
		}

		for (const status of ["draft", "sent", "accepted", "declined", "expired"] as const) {
			const quoteId = await adminA.mutation(api.quotes.create, {
				siteUrl: SITE_A,
				clientId,
				packages: [{ name: `Legacy ${status}`, price: 250 }],
			});
			await t.run((ctx) => ctx.db.patch(quoteId, { status }));
			const token = await adminA.mutation(api.portal.createToken, {
				siteUrl: SITE_A,
				type: "quote",
				documentId: quoteId,
				clientId,
			});
			await adminA.mutation(api.portal.markUsed, { token });
			await expect(t.query(api.portal.getPublicByToken, { token })).resolves.toBeNull();
		}

		for (const status of ["draft", "sent", "signed", "expired"] as const) {
			const contractId = await adminA.mutation(api.contracts.create, {
				siteUrl: SITE_A,
				clientId,
				title: `Legacy ${status}`,
				body: "Terms",
			});
			await t.run((ctx) => ctx.db.patch(contractId, { status }));
			const token = await adminA.mutation(api.portal.createToken, {
				siteUrl: SITE_A,
				type: "contract",
				documentId: contractId,
				clientId,
			});
			await adminA.mutation(api.portal.markUsed, { token });
			await expect(t.query(api.portal.getPublicByToken, { token })).resolves.toBeNull();
		}
	});

	test("returns null for an expired used-only legacy document capability", async () => {
		const { t, adminA, clientId } = await setup();
		const invoiceId = await createInvoice(adminA, clientId);
		const token = await adminA.mutation(api.portal.createToken, {
			siteUrl: SITE_A,
			type: "invoice",
			documentId: invoiceId,
			clientId,
		});
		await adminA.mutation(api.portal.markUsed, { token });
		await t.run(async (ctx) => {
			const portal = await ctx.db
				.query("portalTokens")
				.withIndex("by_token", (q) => q.eq("token", token))
				.unique();
			if (!portal) throw new Error("Expected legacy invoice portal");
			await ctx.db.patch(portal._id, { expiresAt: Date.now() - 1 });
		});

		await expect(t.query(api.portal.getPublicByToken, { token })).resolves.toBeNull();
		await expect(t.query(api.portal.getByToken, { token })).resolves.toBeNull();
	});

	test("bounds and validates public contract signature evidence", async () => {
		const { t, adminA, clientId } = await setup();
		const contractId = await adminA.mutation(api.contracts.create, {
			siteUrl: SITE_A,
			clientId,
			title: "Signature limits",
			body: "Terms",
		});
		await t.run((ctx) => ctx.db.patch(contractId, { status: "sent" }));
		const makeToken = () =>
			adminA.mutation(api.portal.createToken, {
				siteUrl: SITE_A,
				type: "contract",
				documentId: contractId,
				clientId,
			});

		await expect(
			t.mutation(api.portal.signContract, {
				token: await makeToken(),
				signerName: "界".repeat(67),
			}),
		).rejects.toThrow("Signer name is too long");
		await expect(
			t.mutation(api.portal.signContract, {
				token: await makeToken(),
				signerName: "Jane\nInjected",
			}),
		).rejects.toThrow("Signer name contains invalid characters");
		await expect(
			t.mutation(api.portal.signContract, {
				token: await makeToken(),
				signerName: "Jane",
				signerEmail: "not an email",
			}),
		).rejects.toThrow("Signer email is invalid");
		await expect(
			t.mutation(api.portal.signContract, {
				token: await makeToken(),
				signerName: "Jane",
				signatureData: "界".repeat(87_382),
			}),
		).rejects.toThrow("Signature data is too long");
	});
});

describe("portal public projections and validity boundaries", () => {
	test("returns only client-safe document fields from both public query names", async () => {
		const { t, adminA, clientId } = await setup();
		const invoiceId = await createInvoice(adminA, clientId);
		await t.run((ctx) =>
			ctx.db.patch(invoiceId, {
				status: "sent",
				taxPercent: 6,
				notes: "Client-visible invoice note",
				dueDate: "2026-09-20",
				stripeCheckoutSessionId: "cs_private_invoice_sentinel",
				stripeCheckoutFingerprint: "private-fingerprint-sentinel",
				stripeCheckoutStatus: "open",
				parentInvoiceId: invoiceId,
			}),
		);
		const invoiceToken = await adminA.mutation(api.portal.createToken, {
			siteUrl: SITE_A,
			type: "invoice",
			documentId: invoiceId,
			clientId,
		});

		const quoteId = await adminA.mutation(api.quotes.create, {
			siteUrl: SITE_A,
			clientId,
			category: "photography",
			packages: [{ name: "Portrait", description: "Session", price: 250 }],
			validUntil: "2099-12-31",
			notes: "Client-visible quote note",
		});
		await t.run((ctx) =>
			ctx.db.patch(quoteId, {
				status: "sent",
				acceptedAt: 1_700_000_000_000,
				convertedToInvoice: invoiceId,
			}),
		);
		const quoteToken = await adminA.mutation(api.portal.createToken, {
			siteUrl: SITE_A,
			type: "quote",
			documentId: quoteId,
			clientId,
		});

		const contractId = await adminA.mutation(api.contracts.create, {
			siteUrl: SITE_A,
			clientId,
			title: "Client agreement",
			body: "Client-visible terms",
		});
		await t.run((ctx) =>
			ctx.db.patch(contractId, {
				status: "sent",
				signedAt: 1_700_000_100_000,
				signedByName: "private-signer-name-sentinel",
				signedByEmail: "private-signer-email@example.com",
				signatureData: "private-signature-data-sentinel",
				signedIp: "203.0.113.77",
			}),
		);
		const contractToken = await adminA.mutation(api.portal.createToken, {
			siteUrl: SITE_A,
			type: "contract",
			documentId: contractId,
			clientId,
		});
		const [legacyInvoice, legacyQuote, legacyContract] = await Promise.all([
			t.query(api.portal.getByToken, { token: invoiceToken }),
			t.query(api.portal.getByToken, { token: quoteToken }),
			t.query(api.portal.getByToken, { token: contractToken }),
		]);
		if (
			!legacyInvoice ||
			legacyInvoice.expired ||
			!legacyQuote ||
			legacyQuote.expired ||
			!legacyContract ||
			legacyContract.expired
		) {
			throw new Error("Expected live legacy document portal results");
		}
		const [invoice, quote, contract] = await Promise.all([
			t.query(api.portal.getPublicByToken, { token: invoiceToken }),
			t.query(api.portal.getPublicByToken, { token: quoteToken }),
			t.query(api.portal.getPublicByToken, { token: contractToken }),
		]);
		if (!invoice || invoice.expired || !quote || quote.expired || !contract || contract.expired) {
			throw new Error("Expected live document portal projections");
		}
		expect(legacyInvoice).toEqual(invoice);
		expect(legacyQuote).toEqual(quote);
		expect(legacyContract).toEqual(contract);

		expect(Object.keys(invoice.token).sort()).toEqual(["siteUrl", "type", "used"]);
		expect(Object.keys(invoice.client ?? {}).sort()).toEqual(["name"]);
		expect(Object.keys(invoice.document).sort()).toEqual([
			"_creationTime",
			"dueDate",
			"invoiceNumber",
			"items",
			"notes",
			"status",
			"taxPercent",
		]);
		expect(Object.keys(quote.document).sort()).toEqual([
			"_creationTime",
			"notes",
			"packages",
			"quoteNumber",
			"status",
			"validUntil",
		]);
		expect(Object.keys(contract.document).sort()).toEqual([
			"_creationTime",
			"body",
			"signedAt",
			"status",
			"title",
		]);
		const serialized = JSON.stringify({ invoice, quote, contract });
		for (const forbidden of [
			invoiceId,
			quoteId,
			contractId,
			clientId,
			"cs_private_invoice_sentinel",
			"private-fingerprint-sentinel",
			"private-signer-name-sentinel",
			"private-signer-email@example.com",
			"private-signature-data-sentinel",
			"203.0.113.77",
		]) {
			expect(serialized).not.toContain(forbidden);
		}
	});

	test("keeps the raw invoice checkout target behind the server credential", async () => {
		const previousWebhookSecret = process.env.WEBHOOK_SECRET;
		const webhookSecret = "portal-checkout-server-authority-0123456789abcdef";
		process.env.WEBHOOK_SECRET = webhookSecret;
		try {
			const { t, adminA, clientId } = await setup();
			const invoiceId = await createInvoice(adminA, clientId);
			await t.run((ctx) => ctx.db.patch(invoiceId, { status: "sent" }));
			const token = await adminA.mutation(api.portal.createToken, {
				siteUrl: SITE_A,
				type: "invoice",
				documentId: invoiceId,
				clientId,
			});

			await expect(
				t.query(api.portal.getInvoiceCheckoutTarget, {
					token,
					webhookSecret: "wrong-portal-checkout-authority-0123456789abcdef",
				}),
			).rejects.toThrow("webhook secret mismatch");
			await expect(
				t.query(api.portal.getInvoiceCheckoutTarget, { token, webhookSecret }),
			).resolves.toMatchObject({ invoiceId, siteUrl: SITE_A, status: "sent" });

			const publicResult = await t.query(api.portal.getPublicByToken, { token });
			expect(JSON.stringify(publicResult)).not.toContain(invoiceId);

			await t.run(async (ctx) => {
				const portal = await ctx.db
					.query("portalTokens")
					.withIndex("by_token", (q) => q.eq("token", token))
					.unique();
				if (!portal) throw new Error("Expected invoice portal token");
				await ctx.db.patch(portal._id, { used: true, revokedAt: Date.now() });
			});
			await expect(t.query(api.portal.getPublicByToken, { token })).resolves.toBeNull();
			await expect(
				t.query(api.portal.getInvoiceCheckoutTarget, { token, webhookSecret }),
			).resolves.toBeNull();
			await expect(
				t.run(async (ctx) =>
					await ctx.db
						.query("portalTokens")
						.withIndex("by_token", (q) => q.eq("token", token))
						.unique(),
				),
			).resolves.toMatchObject({ used: true, revokedAt: expect.any(Number) });
		} finally {
			if (previousWebhookSecret === undefined) {
				delete process.env.WEBHOOK_SECRET;
			} else {
				process.env.WEBHOOK_SECRET = previousWebhookSecret;
			}
		}
	});

	test("keeps gallery reads on their existing raw delivery contract", async () => {
		const { t, adminA, clientId } = await setup();
		const galleryId = await adminA.mutation(api.galleries.create, {
			siteUrl: SITE_A,
			clientId,
			name: "Delivery gallery",
			slug: "delivery-gallery",
			downloadEnabled: true,
			favoritesEnabled: true,
		});
		const token = await adminA.mutation(api.portal.createToken, {
			siteUrl: SITE_A,
			type: "gallery",
			documentId: galleryId,
			clientId,
		});
		const [legacyResult, publicResult] = await Promise.all([
			t.query(api.portal.getByToken, { token }),
			t.query(api.portal.getPublicByToken, { token }),
		]);
		if (!legacyResult || legacyResult.expired || !publicResult || publicResult.expired) {
			throw new Error("Expected gallery portal results");
		}
		expect(publicResult).toEqual(legacyResult);
		expect(publicResult.token).toMatchObject({
			documentId: galleryId,
			clientId,
			type: "gallery",
		});
		expect(publicResult.document).toMatchObject({
			_id: galleryId,
			slug: "delivery-gallery",
		});
	});

	test("accepts through the complete UTC validity date and rejects at its exclusive boundary", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-01T23:59:59.999Z"));
		const { t, adminA, clientId } = await setup();
		const liveQuoteId = await adminA.mutation(api.quotes.create, {
			siteUrl: SITE_A,
			clientId,
			packages: [{ name: "Live", price: 250 }],
			validUntil: "2026-09-01",
		});
		await t.run((ctx) => ctx.db.patch(liveQuoteId, { status: "sent" }));
		const liveToken = await adminA.mutation(api.portal.createToken, {
			siteUrl: SITE_A,
			type: "quote",
			documentId: liveQuoteId,
			clientId,
		});
		await expect(t.mutation(api.portal.acceptQuote, { token: liveToken })).resolves.toBeNull();

		const expiredQuoteId = await adminA.mutation(api.quotes.create, {
			siteUrl: SITE_A,
			clientId,
			packages: [{ name: "Expired", price: 300 }],
			validUntil: "2026-09-01",
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(expiredQuoteId, { status: "sent" });
			await ctx.db.insert("portalTokens", {
				token: SECOND_PORTAL_TOKEN,
				siteUrl: SITE_A,
				type: "quote",
				documentId: expiredQuoteId,
				clientId,
				used: false,
			});
		});
		vi.setSystemTime(new Date("2026-09-02T00:00:00.000Z"));
		await expect(
			t.query(api.portal.getPublicByToken, { token: SECOND_PORTAL_TOKEN }),
		).resolves.toMatchObject({ expired: false, document: { status: "expired" } });
		await expect(
			t.mutation(api.portal.acceptQuote, { token: SECOND_PORTAL_TOKEN }),
		).rejects.toThrow("Quote has expired");
		await expect(t.run((ctx) => ctx.db.get(expiredQuoteId))).resolves.toMatchObject({
			status: "sent",
		});
	});
});
