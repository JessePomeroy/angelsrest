import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import {
	issueTenantPrintSource,
	issueTenantPrintSourceCapability,
	storePrintArtifact,
} from "$lib/server/catalogCommerceClients";
import { resolveStoredCommerceTenant } from "$lib/server/commerceTenant";
import { getConvex } from "$lib/server/convexClient";
import { FulfillmentValidationError } from "$lib/server/fulfillmentValidationError";
import { logStructured } from "$lib/server/logger";
import { createOrder as createLumaPrintsOrder } from "$lib/server/lumaprints";
import { handleCheckoutCompleted } from "$lib/server/orderIntake";
import { PrintReconciliationPendingError } from "$lib/server/printFulfillment";
import { renderPrintSource } from "$lib/server/printSourcePreparation";
import { getResend } from "$lib/server/resendClient";
import { resolveSnapshotPrintSources } from "$lib/server/snapshotFulfillment";
import { getStripe } from "$lib/server/stripeClient";
import { getWebhookSecret } from "$lib/server/webhookSecret";
import type { OrderItem } from "$lib/shop/types";

/** One leased, checkpointed step. A retry cannot repeat already prepared images or a provider POST. */
export async function runPrintFulfillmentStep(
	jobId: Id<"printFulfillmentJobs">,
	leaseToken: string,
) {
	const convex = getConvex();
	const authority = { jobId, leaseToken, webhookSecret: getWebhookSecret() };
	const { job, order, sources } = await convex.query(api.printFulfillmentJobs.read, authority);
	try {
		if (job.stage === "resolve") {
			const snapshot = order.checkoutSnapshot;
			if (!snapshot || snapshot.catalogProvider !== "convex")
				throw new FulfillmentValidationError("Paid snapshot is unavailable");
			const resolved = await resolveSnapshotPrintSources(
				{
					...snapshot,
					catalogProvider: "convex",
					items: snapshot.items.map((item) => ({
						...item,
						materialOptionKey: item.materialOptionKey ?? null,
						sizeOptionKey: item.sizeOptionKey ?? null,
						borderOptionKey: item.borderOptionKey ?? null,
						frameOptionKey: item.frameOptionKey ?? null,
					})),
				},
				order.stripeSessionId,
				job.cursor,
				order.items[job.cursor]?.quantity ?? 0,
			);
			await convex.mutation(api.printFulfillmentJobs.advance, {
				...authority,
				result: { kind: "resolved", sources: resolved },
			});
		} else if (job.stage === "prepare") {
			const source = sources[0];
			if (!source) throw new FulfillmentValidationError("Print source is unavailable");
			const rendered = await renderPrintSource({
				...source.item,
				imageUrl: await issueTenantPrintSource(source.descriptor, order.siteUrl),
				sourcePolicy: "opaque_capability",
			});
			const descriptor = await storePrintArtifact(order.siteUrl, rendered);
			await convex.mutation(api.printFulfillmentJobs.advance, {
				...authority,
				result: {
					kind: "prepared",
					descriptor,
					item: {
						...source.item,
						width: rendered.geometry.widthInches,
						height: rendered.geometry.heightInches,
					},
				},
			});
		} else if (job.stage === "issue") {
			const urls = await Promise.all(
				sources.map(({ descriptor }) =>
					issueTenantPrintSourceCapability(descriptor, order.siteUrl),
				),
			);
			await convex.mutation(api.printFulfillmentJobs.advance, {
				...authority,
				result: { kind: "issued", urls },
			});
		} else if (job.stage === "finish") {
			const submitted =
				order.printFulfillmentPhase === "submitting" ||
				order.printFulfillmentResolution !== undefined;
			if (
				!submitted &&
				order.status === "new" &&
				!order.stripeRefundId &&
				!order.fulfillmentRecoveryStatus &&
				!order.lumaprintsOrderNumber &&
				sources.some(
					({ url, expiresAt }) =>
						!url || !expiresAt || expiresAt < Date.now() + 23 * 60 * 60 * 1000,
				)
			) {
				await convex.mutation(api.printFulfillmentJobs.advance, {
					...authority,
					result: { kind: "refresh" },
				});
				return;
			}
			const items: OrderItem[] = sources.map(({ item, url }) => ({
				...item,
				imageUrl: url ?? "",
				sourcePolicy: "opaque_capability",
			}));
			const stripe = getStripe();
			const tenant = await resolveStoredCommerceTenant(order, convex);
			const stripeRequestOptions = {
				...tenant.stripeRequestOptions,
				timeout: 8_000,
				maxNetworkRetries: 0,
			};
			const session = await stripe.checkout.sessions.retrieve(
				order.stripeSessionId,
				{},
				stripeRequestOptions,
			);
			try {
				await handleCheckoutCompleted(
					session,
					{
						stripe,
						convex,
						resend: getResend(),
						createLumaPrintsOrder,
						printJob: { jobId, leaseToken, items },
					},
					{ ...tenant, stripeRequestOptions, routingSource: "order", completeLineItems: true },
				);
			} catch (cause) {
				if (!(cause instanceof PrintReconciliationPendingError)) throw cause;
			}
			await convex.mutation(api.printFulfillmentJobs.advance, {
				...authority,
				result: { kind: "finished" },
			});
		}
	} catch (cause) {
		// Raw source URLs, recipient data and provider response bodies never enter diagnostics.
		logStructured({
			event: "print_job.step_failed",
			stage: "lumaprints_submit",
			level: "error",
			orderId: order.orderNumber,
			error: new Error("Print job step failed"),
			meta: { phase: job.stage },
		});
		await convex.mutation(api.printFulfillmentJobs.advance, {
			...authority,
			result:
				cause instanceof FulfillmentValidationError && job.stage !== "finish"
					? { kind: "blocked", code: "preparation_failed" }
					: { kind: "retry", code: "step_failed" },
		});
	}
}
