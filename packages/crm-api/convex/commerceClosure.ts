import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalMutation,
	internalQuery,
	type MutationCtx,
	type QueryCtx,
} from "./_generated/server";
import {
	assertSafeCommerceGeneration,
	checkedAcceptUntilMs,
	commerceControlDecisionFromEnvironment,
	type CommerceBackendPurpose,
	isCommerceTenant,
} from "./helpers/commercePurposeControl";
import {
	isBoundedStripeExpiration,
	isStripeCheckoutSessionId,
	isStripeConnectedAccountId,
	stripeAccountScope,
} from "./helpers/checkoutSnapshot";

export const ACTIVE_ADMISSION_LEASE_MS = 120_000;
export const ORDER_SESSION_LIFETIME_SECONDS = 86_100;
const PAID_SAFE_DELAY_MS = 35 * 24 * 60 * 60 * 1000;
const ADMISSION_RETRY_DELAYS_MS = [60 * 60 * 1000, 6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000] as const;
const HEX_DIGEST = /^[0-9a-f]{64}$/;

const purposeValidator = v.union(
	v.literal("new_order_admission"),
	v.literal("new_provider_submission"),
);
const controlStateValidator = v.union(v.literal("open"), v.literal("closed"));
const proofClassValidator = v.union(
	v.literal("same_origin_host_proof"),
	v.literal("signed_bridge_body"),
);

function validDigest(value: string) {
	return HEX_DIGEST.test(value);
}

async function canonicalSiteForConnectedAccount(ctx: QueryCtx, account: string) {
	const client = await ctx.db.query("platformClients")
		.withIndex("by_stripeConnectedAccountId", (q) => q.eq("stripeConnectedAccountId", account))
		.unique();
	return client?.siteUrl ?? null;
}

async function accountMatchesSite(
	ctx: QueryCtx,
	siteUrl: string,
	account: string | undefined,
) {
	return account === undefined || await canonicalSiteForConnectedAccount(ctx, account) === siteUrl;
}

export async function getDurablePurposeControl(
	ctx: QueryCtx,
	siteUrl: string,
	purpose: CommerceBackendPurpose,
) {
	return await ctx.db.query("commercePurposeControls")
		.withIndex("by_siteUrl_and_purpose", (q) => q.eq("siteUrl", siteUrl).eq("purpose", purpose))
		.unique();
}

function assertControlTuple(
	row: Doc<"commercePurposeControls"> | null,
	state: "open" | "closed",
	generation: number,
) {
	if (!row || row.state !== state || row.generation !== generation) {
		throw new Error("Commerce control tuple is unavailable");
	}
}

/**
 * Activate only the exact tuple present in the purpose-specific environment
 * registry. Same-tuple calls replay; epochs are monotonic and never repurposed.
 */
export const activatePurposeControl = internalMutation({
	args: {
		siteUrl: v.string(),
		purpose: purposeValidator,
		state: controlStateValidator,
		generation: v.number(),
		acceptedHostGeneration: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		if (!isCommerceTenant(args.siteUrl)) throw new Error("Commerce tenant is invalid");
		assertSafeCommerceGeneration(args.generation);
		if (args.acceptedHostGeneration !== undefined) {
			assertSafeCommerceGeneration(args.acceptedHostGeneration);
		}
		if (
			args.purpose === "new_order_admission"
			&& args.acceptedHostGeneration === undefined
		) throw new Error("Admission control requires a host generation");
		if (
			args.purpose === "new_provider_submission"
			&& args.acceptedHostGeneration !== undefined
		) throw new Error("Provider control cannot accept a host generation");

		const intended = commerceControlDecisionFromEnvironment(args.purpose, args.siteUrl);
		if (
			!intended.valid
			|| intended.state !== args.state
			|| intended.generation !== args.generation
		) throw new Error("Commerce control environment intent does not match activation");

		const existing = await getDurablePurposeControl(ctx, args.siteUrl, args.purpose);
		if (existing) {
			if (
				existing.generation === args.generation
				&& existing.state === args.state
				&& existing.acceptedHostGeneration === args.acceptedHostGeneration
			) return { outcome: "replayed" as const, generation: existing.generation };
			if (args.generation <= existing.generation) {
				throw new Error("Commerce control generation cannot regress or be reused");
			}
			await ctx.db.patch(existing._id, {
				state: args.state,
				generation: args.generation,
				acceptedHostGeneration: args.acceptedHostGeneration,
				updatedAt: Date.now(),
			});
			return { outcome: "advanced" as const, generation: args.generation };
		}

		const now = Date.now();
		await ctx.db.insert("commercePurposeControls", {
			siteUrl: args.siteUrl,
			purpose: args.purpose,
			state: args.state,
			generation: args.generation,
			acceptedHostGeneration: args.acceptedHostGeneration,
			createdAt: now,
			updatedAt: now,
		});
		return { outcome: "created" as const, generation: args.generation };
	},
});

export const getNormalizedPurposeControls = internalQuery({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		if (!isCommerceTenant(siteUrl)) {
			return { outcome: "invalid_tenant" as const };
		}
		const [admission, provider] = await Promise.all([
			getDurablePurposeControl(ctx, siteUrl, "new_order_admission"),
			getDurablePurposeControl(ctx, siteUrl, "new_provider_submission"),
		]);
		return {
			outcome: "resolved" as const,
			admission: admission
				? {
						state: admission.state,
						generation: admission.generation,
						hostGeneration: admission.acceptedHostGeneration ?? null,
					}
				: { state: "closed" as const, generation: null, hostGeneration: null },
			provider: provider
				? { state: provider.state, generation: provider.generation }
				: { state: "closed" as const, generation: null },
		};
	},
});

export const beginCheckoutSessionAdmission = internalMutation({
	args: {
		siteUrl: v.string(),
		stripeConnectedAccountId: v.optional(v.string()),
		attemptDigest: v.string(),
		proofClass: proofClassValidator,
		admissionHandleHash: v.string(),
		requestFingerprint: v.string(),
		activeLeaseTokenHash: v.string(),
		hostGeneration: v.number(),
	},
	handler: async (ctx, args) => {
		if (
			!isCommerceTenant(args.siteUrl)
			|| args.stripeConnectedAccountId !== undefined
				&& !isStripeConnectedAccountId(args.stripeConnectedAccountId)
			|| !validDigest(args.attemptDigest)
			|| !validDigest(args.admissionHandleHash)
			|| !validDigest(args.requestFingerprint)
			|| !validDigest(args.activeLeaseTokenHash)
		) throw new Error("Checkout admission input is invalid");
		assertSafeCommerceGeneration(args.hostGeneration);
		if (!await accountMatchesSite(ctx, args.siteUrl, args.stripeConnectedAccountId)) {
			throw new Error("Checkout admission routing does not match tenant");
		}
		const control = await getDurablePurposeControl(ctx, args.siteUrl, "new_order_admission");
		if (
			!control
			|| control.state !== "open"
			|| control.acceptedHostGeneration !== args.hostGeneration
		) throw new Error("New order admission is closed");

		const accountScope = stripeAccountScope(args.stripeConnectedAccountId);
		const existing = await ctx.db.query("checkoutSessionAdmissions")
			.withIndex("by_siteUrl_and_accountScope_and_attemptDigest", (q) => q
				.eq("siteUrl", args.siteUrl)
				.eq("accountScope", accountScope)
				.eq("attemptDigest", args.attemptDigest))
			.unique();
		if (existing) {
			if (
				existing.proofClass !== args.proofClass
				|| existing.requestFingerprint !== args.requestFingerprint
				|| existing.admissionHandleHash !== args.admissionHandleHash
				|| existing.stripeConnectedAccountId !== args.stripeConnectedAccountId
				|| existing.hostGeneration !== args.hostGeneration
				|| existing.admissionGeneration !== control.generation
				|| existing.state === "active_prestripe"
					&& existing.activeLeaseTokenHash !== args.activeLeaseTokenHash
			) throw new Error("Checkout admission attempt conflicts");
			return {
				outcome: "replayed" as const,
				admissionId: existing._id,
				state: existing.state,
				admissionGeneration: existing.admissionGeneration,
				...(existing.requestedStripeExpiresAt === undefined
					? {}
					: { requestedStripeExpiresAt: existing.requestedStripeExpiresAt }),
			};
		}

		const createdAt = Date.now();
		const activeLeaseExpiresAt = createdAt + ACTIVE_ADMISSION_LEASE_MS;
		const admissionId = await ctx.db.insert("checkoutSessionAdmissions", {
			protocolVersion: 1,
			siteUrl: args.siteUrl,
			accountScope,
			stripeConnectedAccountId: args.stripeConnectedAccountId,
			attemptDigest: args.attemptDigest,
			proofClass: args.proofClass,
			admissionHandleHash: args.admissionHandleHash,
			hostGeneration: args.hostGeneration,
			admissionGeneration: control.generation,
			state: "active_prestripe",
			requestFingerprint: args.requestFingerprint,
			activeLeaseTokenHash: args.activeLeaseTokenHash,
			activeLeaseExpiresAt,
			createdAt,
			updatedAt: createdAt,
		});
		await ctx.scheduler.runAt(
			activeLeaseExpiresAt,
			internal.commerceClosure.expireActiveCheckoutSessionAdmission,
			{ admissionId, activeLeaseTokenHash: args.activeLeaseTokenHash, activeLeaseExpiresAt },
		);
		return {
			outcome: "created" as const,
			admissionId,
			state: "active_prestripe" as const,
			admissionGeneration: control.generation,
		};
	},
});

export const expireActiveCheckoutSessionAdmission = internalMutation({
	args: {
		admissionId: v.id("checkoutSessionAdmissions"),
		activeLeaseTokenHash: v.string(),
		activeLeaseExpiresAt: v.number(),
	},
	handler: async (ctx, args) => {
		const row = await ctx.db.get(args.admissionId);
		if (
			!row
			|| row.state !== "active_prestripe"
			|| row.activeLeaseTokenHash !== args.activeLeaseTokenHash
			|| row.activeLeaseExpiresAt !== args.activeLeaseExpiresAt
			|| Date.now() < args.activeLeaseExpiresAt
		) return false;
		await ctx.db.patch(row._id, {
			state: "released_definite_no_session",
			activeLeaseTokenHash: undefined,
			activeLeaseExpiresAt: undefined,
			updatedAt: Date.now(),
			terminalAt: Date.now(),
		});
		return true;
	},
});

export const releaseCheckoutSessionAdmission = internalMutation({
	args: {
		siteUrl: v.string(),
		admissionId: v.id("checkoutSessionAdmissions"),
		activeLeaseTokenHash: v.string(),
	},
	handler: async (ctx, args) => {
		const row = await ctx.db.get(args.admissionId);
		if (
			!row
			|| row.siteUrl !== args.siteUrl
			|| row.state !== "active_prestripe"
			|| row.activeLeaseTokenHash !== args.activeLeaseTokenHash
		) return false;
		const now = Date.now();
		await ctx.db.patch(row._id, {
			state: "released_definite_no_session",
			activeLeaseTokenHash: undefined,
			activeLeaseExpiresAt: undefined,
			updatedAt: now,
			terminalAt: now,
		});
		return true;
	},
});

export const markCheckoutSessionCreating = internalMutation({
	args: {
		siteUrl: v.string(),
		admissionId: v.id("checkoutSessionAdmissions"),
		activeLeaseTokenHash: v.string(),
		requestFingerprint: v.string(),
		stripeIdempotencyDigest: v.string(),
	},
	handler: async (ctx, args) => {
		if (
			!validDigest(args.requestFingerprint)
			|| !validDigest(args.stripeIdempotencyDigest)
		) throw new Error("Checkout creation identity is invalid");
		const row = await ctx.db.get(args.admissionId);
		if (!row || row.siteUrl !== args.siteUrl) {
			throw new Error("Checkout admission is unavailable");
		}
		if (
			(row.state === "creating"
				|| row.state === "creation_uncertain"
				|| row.state === "bound")
			&& row.requestFingerprint === args.requestFingerprint
			&& row.stripeIdempotencyDigest === args.stripeIdempotencyDigest
			&& row.requestedStripeExpiresAt !== undefined
		) {
			return {
				state: row.state,
				requestedStripeExpiresAt: row.requestedStripeExpiresAt,
			};
		}
		if (
			row.state !== "active_prestripe"
			|| row.activeLeaseTokenHash !== args.activeLeaseTokenHash
			|| row.requestFingerprint !== args.requestFingerprint
		) throw new Error("Checkout admission cannot begin creation");
		const control = await getDurablePurposeControl(ctx, row.siteUrl, "new_order_admission");
		assertControlTuple(control, "open", row.admissionGeneration);
		if (control?.acceptedHostGeneration !== row.hostGeneration) {
			throw new Error("Checkout admission host generation is stale");
		}
		const creatingAt = Date.now();
		const requestedStripeExpiresAt = Math.floor(creatingAt / 1000)
			+ ORDER_SESSION_LIFETIME_SECONDS;
		if (!Number.isSafeInteger(requestedStripeExpiresAt)) {
			throw new Error("Checkout Session expiration is unsafe");
		}
		await ctx.db.patch(row._id, {
			state: "creating",
			activeLeaseTokenHash: undefined,
			activeLeaseExpiresAt: undefined,
			stripeIdempotencyDigest: args.stripeIdempotencyDigest,
			requestedStripeExpiresAt,
			creatingAt,
			updatedAt: creatingAt,
		});
		return { state: "creating" as const, requestedStripeExpiresAt };
	},
});

export const markCheckoutSessionCreationUncertain = internalMutation({
	args: {
		siteUrl: v.string(),
		admissionId: v.id("checkoutSessionAdmissions"),
		requestFingerprint: v.string(),
		stripeIdempotencyDigest: v.string(),
	},
	handler: async (ctx, args) => {
		const row = await ctx.db.get(args.admissionId);
		if (
			!row
			|| row.siteUrl !== args.siteUrl
			|| row.state !== "creating"
			|| row.requestFingerprint !== args.requestFingerprint
			|| row.stripeIdempotencyDigest !== args.stripeIdempotencyDigest
		) return false;
		await ctx.db.patch(row._id, {
			state: "creation_uncertain",
			updatedAt: Date.now(),
		});
		return true;
	},
});

export const bindCheckoutSessionAdmission = internalMutation({
	args: {
		siteUrl: v.string(),
		admissionId: v.id("checkoutSessionAdmissions"),
		requestFingerprint: v.string(),
		stripeIdempotencyDigest: v.string(),
		stripeSessionId: v.string(),
		stripeExpiresAt: v.number(),
		checkoutSnapshotHandleHash: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		if (!isStripeCheckoutSessionId(args.stripeSessionId)) {
			throw new Error("Checkout Session identity is invalid");
		}
		const row = await ctx.db.get(args.admissionId);
		if (!row || row.siteUrl !== args.siteUrl) {
			throw new Error("Checkout admission is unavailable");
		}
		if (row.state === "bound") {
			const replayed = row.requestFingerprint === args.requestFingerprint
				&& row.stripeIdempotencyDigest === args.stripeIdempotencyDigest
				&& row.stripeSessionId === args.stripeSessionId
				&& row.stripeExpiresAt === args.stripeExpiresAt
				&& row.checkoutSnapshotHandleHash === args.checkoutSnapshotHandleHash;
			if (!replayed) throw new Error("Checkout admission binding conflicts");
			return { outcome: "replayed" as const };
		}
		if (
			(row.state !== "creating" && row.state !== "creation_uncertain")
			|| row.requestFingerprint !== args.requestFingerprint
			|| row.stripeIdempotencyDigest !== args.stripeIdempotencyDigest
			|| row.requestedStripeExpiresAt !== args.stripeExpiresAt
			|| !isBoundedStripeExpiration(args.stripeExpiresAt, Math.floor((row.creatingAt ?? 0) / 1000))
		) throw new Error("Checkout admission cannot bind Session");
		const control = await getDurablePurposeControl(ctx, row.siteUrl, "new_order_admission");
		assertControlTuple(control, "open", row.admissionGeneration);
		if (control?.acceptedHostGeneration !== row.hostGeneration) {
			throw new Error("Checkout admission host generation is stale");
		}
		const owner = await ctx.db.query("checkoutSessionAdmissions")
			.withIndex("by_accountScope_and_stripeSessionId", (q) => q
				.eq("accountScope", row.accountScope)
				.eq("stripeSessionId", args.stripeSessionId))
			.unique();
		if (owner && owner._id !== row._id) throw new Error("Checkout Session already has an admission");

		const now = Date.now();
		const boundReconcileAt = args.stripeExpiresAt * 1000 + PAID_SAFE_DELAY_MS;
		if (!Number.isSafeInteger(boundReconcileAt)) {
			throw new Error("Reconciliation time is unsafe");
		}
		let checkoutSnapshotReservationId: Id<"checkoutSnapshotReservations"> | undefined;
		if (args.checkoutSnapshotHandleHash !== undefined) {
			if (!validDigest(args.checkoutSnapshotHandleHash)) {
				throw new Error("Checkout snapshot handle is invalid");
			}
			const reservation = await ctx.db.query("checkoutSnapshotReservations")
				.withIndex("by_siteUrl_and_handleHash", (q) => q
					.eq("siteUrl", row.siteUrl)
					.eq("handleHash", args.checkoutSnapshotHandleHash!))
				.unique();
			if (
				!reservation
				|| reservation.state !== "reserved"
				|| reservation.siteUrl !== row.siteUrl
				|| reservation.accountScope !== row.accountScope
				|| reservation.checkoutSessionAdmissionId !== undefined
			) throw new Error("Checkout snapshot reservation cannot bind admission");
			checkoutSnapshotReservationId = reservation._id;
			await ctx.db.patch(reservation._id, {
				state: "bound",
				stripeSessionId: args.stripeSessionId,
				stripeExpiresAt: args.stripeExpiresAt,
				boundAt: now,
				boundReconcileAt,
				updatedAt: now,
				reconciliationAttempt: 0,
				reconciliationNextAt: boundReconcileAt,
				checkoutSessionAdmissionId: row._id,
			});
		}
		await ctx.db.patch(row._id, {
			state: "bound",
			stripeSessionId: args.stripeSessionId,
			stripeExpiresAt: args.stripeExpiresAt,
			checkoutSnapshotReservationId,
			checkoutSnapshotHandleHash: args.checkoutSnapshotHandleHash,
			boundAt: now,
			updatedAt: now,
			reconciliationAttempt: 0,
			reconciliationNextAt: boundReconcileAt,
		});
		await ctx.scheduler.runAt(
			boundReconcileAt,
			internal.stripeFees.reconcileCheckoutSessionAdmission,
			{ admissionId: row._id, boundAt: now, attempt: 0 },
		);
		return { outcome: "bound" as const };
	},
});

export const createProtocolCutoff = internalMutation({
	args: {
		siteUrl: v.string(),
		stripeConnectedAccountId: v.optional(v.string()),
		activationGeneration: v.number(),
	},
	handler: async (ctx, args) => {
		if (
			!isCommerceTenant(args.siteUrl)
			|| args.stripeConnectedAccountId !== undefined
				&& !isStripeConnectedAccountId(args.stripeConnectedAccountId)
			|| !await accountMatchesSite(ctx, args.siteUrl, args.stripeConnectedAccountId)
		) {
			throw new Error("Commerce cutoff scope is invalid");
		}
		assertSafeCommerceGeneration(args.activationGeneration);
		const admissionControl = await getDurablePurposeControl(
			ctx,
			args.siteUrl,
			"new_order_admission",
		);
		assertControlTuple(admissionControl, "open", args.activationGeneration);
		const accountScope = stripeAccountScope(args.stripeConnectedAccountId);
		const existing = await ctx.db.query("commerceProtocolCutoffs")
			.withIndex("by_siteUrl_and_accountScope", (q) => q
				.eq("siteUrl", args.siteUrl)
				.eq("accountScope", accountScope))
			.unique();
		if (existing) {
			if (existing.activationGeneration !== args.activationGeneration) {
				throw new Error("Commerce cutoff cannot be overwritten");
			}
			return { outcome: "replayed" as const };
		}
		const cutoffCreatedSeconds = Math.floor(Date.now() / 1000);
		const acceptUntilMs = checkedAcceptUntilMs(cutoffCreatedSeconds);
		await ctx.db.insert("commerceProtocolCutoffs", {
			protocolVersion: 1,
			siteUrl: args.siteUrl,
			accountScope,
			activationGeneration: args.activationGeneration,
			cutoffCreatedSeconds,
			acceptUntilMs,
			createdAt: Date.now(),
		});
		return { outcome: "created" as const };
	},
});

const transitionBlockingAdmissionStates = [
	"active_prestripe",
	"creating",
	"creation_uncertain",
] as const;
const admittedWorkBlockingStates = [
	"bound",
	"paid_without_order_attention",
	"reconciliation_uncertain_attention",
] as const;

export const getNormalizedAdmissionReadiness = internalQuery({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		if (!isCommerceTenant(siteUrl)) return { outcome: "invalid_tenant" as const };
		const present = async (state: (typeof transitionBlockingAdmissionStates)[number]
			| (typeof admittedWorkBlockingStates)[number]) =>
			(await ctx.db.query("checkoutSessionAdmissions")
				.withIndex("by_siteUrl_and_state", (q) => q.eq("siteUrl", siteUrl).eq("state", state))
				.take(1)).length > 0;
		const transitionRows = await Promise.all(transitionBlockingAdmissionStates.map(
			async (state) => ({ state, present: await present(state) }),
		));
		const admittedWorkRows = await Promise.all(admittedWorkBlockingStates.map(
			async (state) => ({ state, present: await present(state) }),
		));
		const transitionBlockerClasses = transitionRows
			.filter(({ present }) => present)
			.map(({ state }) => state);
		const admittedWorkBlockerClasses = admittedWorkRows
			.filter(({ present }) => present)
			.map(({ state }) => state);
		return {
			outcome: transitionBlockerClasses.length === 0
				&& admittedWorkBlockerClasses.length === 0
				? "clear" as const
				: "incomplete" as const,
			transitionBlockerClasses,
			admittedWorkBlockerClasses,
		};
	},
});

export const getCheckoutAdmissionForReconciliation = internalQuery({
	args: {
		admissionId: v.id("checkoutSessionAdmissions"),
		boundAt: v.number(),
		attempt: v.number(),
	},
	handler: async (ctx, args) => {
		const row = await ctx.db.get(args.admissionId);
		if (
			!row
			|| row.state !== "bound"
			|| row.boundAt !== args.boundAt
			|| row.reconciliationAttempt !== args.attempt
			|| row.reconciliationAlertedAt !== undefined
			|| row.reconciliationNextAt === undefined
			|| Date.now() < row.reconciliationNextAt
			|| row.stripeSessionId === undefined
		) return null;
		const stripeSessionId = row.stripeSessionId;
		const [order, retired] = await Promise.all([
			ctx.db.query("orders")
				.withIndex("by_stripeSessionId", (q) => q.eq("stripeSessionId", stripeSessionId))
				.unique(),
			ctx.db.query("retiredOrderSessions")
				.withIndex("by_stripeSessionId", (q) => q.eq("stripeSessionId", stripeSessionId))
				.unique(),
		]);
		if (order || retired) return null;
		return {
			stripeSessionId,
			stripeConnectedAccountId: row.stripeConnectedAccountId,
		};
	},
});

export const recordCheckoutAdmissionReconciliation = internalMutation({
	args: {
		admissionId: v.id("checkoutSessionAdmissions"),
		boundAt: v.number(),
		attempt: v.number(),
		paid: v.boolean(),
		expiredUnpaid: v.boolean(),
		providerSessionVerified: v.boolean(),
	},
	handler: async (ctx, args) => {
		const row = await ctx.db.get(args.admissionId);
		if (
			!row
			|| row.state !== "bound"
			|| row.boundAt !== args.boundAt
			|| row.reconciliationAttempt !== args.attempt
			|| row.reconciliationAlertedAt !== undefined
			|| row.reconciliationNextAt === undefined
			|| Date.now() < row.reconciliationNextAt
		) return { alert: null };

		const reservation = row.checkoutSnapshotReservationId === undefined
			? null
			: await ctx.db.get(row.checkoutSnapshotReservationId);
		if (row.checkoutSnapshotReservationId !== undefined && (
			!reservation
			|| reservation.state !== "bound"
			|| reservation.checkoutSessionAdmissionId !== row._id
			|| reservation.stripeSessionId !== row.stripeSessionId
			|| reservation.boundAt !== row.boundAt
		)) {
			const now = Date.now();
			await ctx.db.patch(row._id, {
				state: "reconciliation_uncertain_attention",
				reconciliationNextAt: undefined,
				reconciliationAlertedAt: now,
				updatedAt: now,
			});
			return { alert: "reconciliation_uncertain" as const };
		}

		const now = Date.now();
		const providerVerifiedAt = args.providerSessionVerified
			? row.reconciliationProviderVerifiedAt ?? now
			: row.reconciliationProviderVerifiedAt;
		if (args.expiredUnpaid && args.providerSessionVerified) {
			await ctx.db.patch(row._id, {
				state: "expired_unpaid_provider_verified",
				reconciliationNextAt: undefined,
				reconciliationProviderVerifiedAt: providerVerifiedAt,
				updatedAt: now,
				terminalAt: now,
			});
			if (reservation) await ctx.db.delete(reservation._id);
			return { alert: null };
		}

		const delay = args.paid ? undefined : ADMISSION_RETRY_DELAYS_MS[args.attempt];
		if (delay !== undefined) {
			const nextAt = now + delay;
			await ctx.db.patch(row._id, {
				reconciliationAttempt: args.attempt + 1,
				reconciliationNextAt: nextAt,
				reconciliationProviderVerifiedAt: providerVerifiedAt,
				updatedAt: now,
			});
			if (reservation) {
				await ctx.db.patch(reservation._id, {
					reconciliationAttempt: args.attempt + 1,
					reconciliationNextAt: nextAt,
					reconciliationProviderVerifiedAt: providerVerifiedAt,
					updatedAt: now,
				});
			}
			await ctx.scheduler.runAt(
				nextAt,
				internal.stripeFees.reconcileCheckoutSessionAdmission,
				{ admissionId: row._id, boundAt: args.boundAt, attempt: args.attempt + 1 },
			);
			return { alert: null };
		}

		const alert = args.paid ? "paid_without_order" as const : "reconciliation_uncertain" as const;
		await ctx.db.patch(row._id, {
			state: args.paid
				? "paid_without_order_attention"
				: "reconciliation_uncertain_attention",
			reconciliationNextAt: undefined,
			reconciliationProviderVerifiedAt: providerVerifiedAt,
			reconciliationAlertedAt: now,
			updatedAt: now,
		});
		if (reservation) {
			await ctx.db.patch(reservation._id, {
				reconciliationAttempt: args.attempt,
				reconciliationNextAt: undefined,
				reconciliationProviderVerifiedAt: providerVerifiedAt,
				reconciliationAlertedAt: now,
				updatedAt: now,
			});
		}
		return { alert };
	},
});

export const getNormalizedProviderReadiness = internalQuery({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		if (!isCommerceTenant(siteUrl)) return { outcome: "invalid_tenant" as const };
		const orders = await ctx.db.query("orders")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.take(501);
		if (orders.length > 500) {
			return { outcome: "incomplete" as const, blockerClasses: ["scan_cap"] };
		}
		const blockers = new Set<string>();
		for (const order of orders) {
			if (
				order.lumaprintsOrderNumber !== undefined
				|| order.printFulfillmentResolution === "resolved"
			) continue;
			if (
				order.fulfillmentType !== "lumaprints"
				|| order.status === "refunded"
				|| order.stripeRefundId !== undefined
				|| order.fulfillmentRecoveryStatus !== undefined
			) continue;
			if (
				order.printFulfillmentPhase === "submitting"
				|| order.printFulfillmentResolution === "submission_uncertain"
				|| order.printFulfillmentResolution === "reconciliation_blocked"
			) continue;
			if (
				order.printFulfillmentCoordinatorVersion === 4
				&& order.printProviderAdmissionStatus === "admitted"
				&& order.printProviderAdmissionGeneration !== undefined
			) {
				blockers.add(order.printFulfillmentPhase === "preparing"
					? "preparing"
					: "admitted_idle");
				continue;
			}
			if (
				order.printFulfillmentCoordinatorVersion === 4
				|| order.printProviderAdmissionStatus !== undefined
				|| order.printProviderAdmissionGeneration !== undefined
			) {
				blockers.add("blocked_contradiction");
				continue;
			}
			if (order.status === "new") blockers.add("requires_first_provider_admission");
			else blockers.add("blocked_legacy_unknown");
		}
		const blockerClasses = [...blockers].sort();
		return {
			outcome: blockerClasses.length === 0 ? "clear" as const : "incomplete" as const,
			blockerClasses,
		};
	},
});

export type CheckoutAdmissionCandidate = {
	version: 1;
	handleHash: string;
};

export async function consumeCheckoutSessionAdmission(
	ctx: MutationCtx,
	args: {
		siteUrl: string;
		stripeConnectedAccountId: string | undefined;
		stripeSessionId: string;
		candidate: unknown;
	},
) {
	const candidate = args.candidate as Partial<CheckoutAdmissionCandidate> | null;
	if (
		!candidate
		|| candidate.version !== 1
		|| typeof candidate.handleHash !== "string"
		|| !validDigest(candidate.handleHash)
	) throw new Error("Checkout admission candidate is invalid");
	const handleHash = candidate.handleHash;
	const row = await ctx.db.query("checkoutSessionAdmissions")
		.withIndex("by_admissionHandleHash", (q) => q.eq("admissionHandleHash", handleHash))
		.unique();
	if (
		!row
		|| row.state !== "bound"
		|| row.siteUrl !== args.siteUrl
		|| row.accountScope !== stripeAccountScope(args.stripeConnectedAccountId)
		|| row.stripeConnectedAccountId !== args.stripeConnectedAccountId
		|| row.stripeSessionId !== args.stripeSessionId
	) throw new Error("Checkout admission does not match paid Session");
	await ctx.db.patch(row._id, {
		state: "consumed_order",
		updatedAt: Date.now(),
		terminalAt: Date.now(),
	});
	return row;
}
