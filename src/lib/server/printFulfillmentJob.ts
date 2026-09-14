import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import {
	CatalogBoundaryError,
	issueTenantPrintSource,
	issueTenantPrintSourceCapability,
	storePrintArtifact,
} from "$lib/server/catalogCommerceClients";
import { resolveStoredCommerceTenant } from "$lib/server/commerceTenant";
import { getConvex } from "$lib/server/convexClient";
import { FulfillmentValidationError } from "$lib/server/fulfillmentValidationError";
import { logStructured } from "$lib/server/logger";
import { createOrder as createLumaPrintsOrder } from "$lib/server/lumaprints";
import { deliverFulfillmentOutcome, handleCheckoutCompleted } from "$lib/server/orderIntake";
import { PrintReconciliationPendingError } from "$lib/server/printFulfillment";
import { renderPrintSource } from "$lib/server/printSourcePreparation";
import { getResend } from "$lib/server/resendClient";
import { RuntimeConfigurationError } from "$lib/server/runtimeConfig";
import { resolveSnapshotPrintSources } from "$lib/server/snapshotFulfillment";
import { getStripe } from "$lib/server/stripeClient";
import type { OrderEmailSession, ShippingDetails } from "$lib/server/webhookEmails";
import { finishRecordedPrintOrder } from "$lib/server/webhookOrders";
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
	let operation: string = job.stage;
	const startedAt = Date.now();
	try {
		if (job.stage === "resolve") {
			if (order.printInput) {
				const line = order.printInput.lines[job.cursor];
				const quantity = order.items[job.cursor]?.quantity;
				if (!line || !Number.isSafeInteger(quantity) || quantity <= 0)
					throw new FulfillmentValidationError("Frozen paid print line is unavailable");
				await convex.mutation(api.printFulfillmentJobs.advance, {
					...authority,
					result: {
						kind: "resolved",
						sources: line.sources.map(({ descriptor, item, product }) => ({
							descriptor,
							item: { ...item, product, quantity },
						})),
					},
				});
				return;
			}
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
			operation = "issue_source";
			const rendered = await renderPrintSource(
				{
					...source.item,
					imageUrl: await issueTenantPrintSource(source.descriptor, order.siteUrl),
					sourcePolicy: "opaque_capability",
				},
				(stage) => {
					operation = stage;
				},
			);
			operation = "store_artifact";
			const descriptor = await storePrintArtifact(
				order.siteUrl,
				rendered,
				undefined,
				order.printInput ? "direct-v1" : "upload-token",
			);
			operation = "checkpoint";
			await convex.mutation(api.printFulfillmentJobs.advance, {
				...authority,
				result: {
					kind: "prepared",
					...(order.printInput ? { recipeVersion: 1 as const } : {}),
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
				sources.map((source) => {
					if (order.printInput && !source.artifact)
						throw new FulfillmentValidationError("Prepared print artifact is unavailable");
					return issueTenantPrintSourceCapability(
						source.artifact?.descriptor ?? source.descriptor,
						order.siteUrl,
					);
				}),
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
			try {
				if (order.printInput) {
					if (!order.shippingRecipientName || !order.shippingAddress)
						throw new FulfillmentValidationError("Frozen shipping recipient is unavailable");
					const session: OrderEmailSession = {
						id: order.stripeSessionId,
						payment_intent: order.stripePaymentIntentId ?? null,
						amount_total: order.total,
						payment_status: "paid",
						metadata: null,
						customer_details: { email: order.customerEmail, name: order.customerName ?? null },
					};
					const address = order.shippingAddress;
					const shippingDetails: ShippingDetails = {
						name: order.shippingRecipientName,
						address: {
							line1: address.line1,
							line2: address.line2 ?? null,
							city: address.city,
							state: address.state,
							postal_code: address.postalCode,
							country: address.country,
						},
					};
					const adapters = { stripe, convex, resend: getResend(), createLumaPrintsOrder };
					const orderResult = await finishRecordedPrintOrder(adapters, {
						orderResult: { ...order, alreadyExisted: true },
						printJob: { jobId, leaseToken, items },
						session,
						shippingDetails,
						// Prepared items already contain the paid quantity and frozen provider options.
						lineItems: [],
						...tenant,
						stripeRequestOptions,
					});
					await deliverFulfillmentOutcome(adapters, {
						orderResult,
						session,
						shippingDetails,
						customerEmail: order.customerEmail,
						lineItems: order.items.map(({ productName, quantity, price }) => ({
							description: productName,
							quantity,
							amount_total: price,
						})),
						notificationProfile: tenant.notificationProfile,
					});
				} else {
					const session = await stripe.checkout.sessions.retrieve(
						order.stripeSessionId,
						{},
						stripeRequestOptions,
					);
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
				}
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
		const errorType =
			cause instanceof CatalogBoundaryError
				? `catalog_${cause.kind}_${cause.phase}`
				: cause instanceof RuntimeConfigurationError
					? "configuration"
					: cause instanceof FulfillmentValidationError
						? "validation"
						: cause instanceof Error &&
								["TypeError", "RangeError", "TimeoutError", "AbortError"].includes(cause.name)
							? cause.name
							: "unexpected";
		logStructured({
			event: "print_job.step_failed",
			stage: "lumaprints_submit",
			level: "error",
			orderId: order.orderNumber,
			durationMs: Date.now() - startedAt,
			error: new Error(`Print job ${operation} failed (${errorType})`),
			meta: { phase: job.stage, operation, sourceIndex: job.cursor, errorType },
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
