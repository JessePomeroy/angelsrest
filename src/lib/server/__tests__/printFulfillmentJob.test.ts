import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	mutation: vi.fn(),
	render: vi.fn(),
	store: vi.fn(),
	issue: vi.fn(),
	finish: vi.fn(),
	directFinish: vi.fn(),
	notify: vi.fn(),
	resolve: vi.fn(),
	retrieve: vi.fn(),
	log: vi.fn(),
	env: { PRINT_FULFILLMENT_RUNNER_SECRET: "r".repeat(40), WEBHOOK_SECRET: "webhook-test-secret" },
}));
vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$lib/server/convexClient", () => ({ getConvex: () => mocks }));
vi.mock("$lib/server/catalogCommerceClients", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/catalogCommerceClients")>()),
	issueTenantPrintSource: mocks.issue,
	issueTenantPrintSourceCapability: mocks.issue,
	storePrintArtifact: mocks.store,
}));
vi.mock("$lib/server/printSourcePreparation", () => ({ renderPrintSource: mocks.render }));
vi.mock("$lib/server/snapshotFulfillment", () => ({ resolveSnapshotPrintSources: mocks.resolve }));
vi.mock("$lib/server/orderIntake", () => ({
	handleCheckoutCompleted: mocks.finish,
	deliverFulfillmentOutcome: mocks.notify,
}));
vi.mock("$lib/server/webhookOrders", () => ({ finishRecordedPrintOrder: mocks.directFinish }));
vi.mock("$lib/server/commerceTenant", () => ({
	resolveStoredCommerceTenant: async () => ({ siteUrl: "angelsrest.online" }),
}));
vi.mock("$lib/server/stripeClient", () => ({
	getStripe: () => ({ checkout: { sessions: { retrieve: mocks.retrieve } } }),
}));
vi.mock("$lib/server/resendClient", () => ({ getResend: () => ({}) }));
vi.mock("$lib/server/logger", () => ({ logStructured: mocks.log }));

import { CatalogBoundaryError } from "$lib/server/catalogCommerceClients";
import { FulfillmentValidationError } from "$lib/server/fulfillmentValidationError";
import { RuntimeConfigurationError } from "$lib/server/runtimeConfig";
import { POST } from "../../../routes/api/internal/print-fulfillment/+server";

const input = { jobId: "a".repeat(32), leaseToken: "123e4567-e89b-42d3-a456-426614174000" };
const source = {
	item: { width: 6, height: 4, quantity: 1, paperSubcategoryId: 103007 },
	descriptor: {
		key: "private-key",
		hash: "a".repeat(64),
		bytes: 10,
		mime: "image/jpeg",
		dimensions: { width: 1800, height: 1200 },
	},
	url: "https://worker.example/private.jpg",
	expiresAt: Date.now() + 24 * 60 * 60 * 1000,
};
const order = {
	siteUrl: "angelsrest.online",
	stripeSessionId: "cs_test_saved",
	orderNumber: "ORD-001",
	status: "new",
	fulfillmentType: "lumaprints",
};
function request(body: unknown = input, secret = mocks.env.PRINT_FULFILLMENT_RUNNER_SECRET) {
	return {
		request: new Request("https://angelsrest.online/api/internal/print-fulfillment", {
			method: "POST",
			headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
	};
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.issue.mockResolvedValue(source.url);
	mocks.render.mockResolvedValue({ geometry: { widthInches: 6, heightInches: 4 } });
	mocks.store.mockResolvedValue(source.descriptor);
});

it.each([
	[request(input, "wrong"), 401],
	[request({ ...input, siteUrl: "other.example" }), 400],
])("rejects unauthorized or caller-selected order data before touching Convex", async (event, status) => {
	await expect(POST(event)).rejects.toMatchObject({ status });
	expect(mocks.query).not.toHaveBeenCalled();
});
it("prepares only the leased source and checkpoints its descriptor, not a bearer URL", async () => {
	mocks.query.mockResolvedValue({ job: { stage: "prepare", cursor: 4 }, order, sources: [source] });
	await POST(request());
	expect(mocks.render).toHaveBeenCalledTimes(1);
	expect(mocks.mutation).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({
			result: {
				kind: "prepared",
				descriptor: source.descriptor,
				item: source.item,
			},
		}),
	);
	expect(mocks.finish).not.toHaveBeenCalled();
});
it.each([
	["download", new DOMException("private URL", "TimeoutError"), "TimeoutError", "retry"],
	["decode", new TypeError("private URL"), "TypeError", "retry"],
	["geometry", new FulfillmentValidationError("private key"), "validation", "blocked"],
	["render", new Error("private customer data"), "unexpected", "retry"],
	[
		"store_artifact",
		new CatalogBoundaryError("rejected", "envelope"),
		"catalog_rejected_envelope",
		"retry",
	],
	["store_artifact", new RuntimeConfigurationError("private config"), "configuration", "retry"],
	["checkpoint", new Error("private lease token"), "unexpected", "retry"],
])("records safe %s failure diagnostics without changing retry behavior", async (operation, cause, errorType, kind) => {
	mocks.query.mockResolvedValue({ job: { stage: "prepare", cursor: 4 }, order, sources: [source] });
	if (operation === "checkpoint") mocks.mutation.mockRejectedValueOnce(cause);
	else if (operation === "store_artifact") mocks.store.mockRejectedValueOnce(cause);
	else
		mocks.render.mockImplementationOnce((_item, onStage) => {
			onStage?.(operation);
			throw cause;
		});
	await POST(request());
	const entry = mocks.log.mock.calls[0]?.[0];
	expect(entry).toMatchObject({
		event: "print_job.step_failed",
		meta: { phase: "prepare", operation, sourceIndex: 4, errorType },
	});
	expect(entry.error.message).toBe(`Print job ${operation} failed (${errorType})`);
	expect(JSON.stringify(entry) + entry.error.stack).not.toContain("private");
	expect(entry.error.cause).toBeUndefined();
	expect(mocks.mutation).toHaveBeenLastCalledWith(
		expect.anything(),
		expect.objectContaining({
			result: { kind, code: kind === "blocked" ? "preparation_failed" : "step_failed" },
		}),
	);
	expect(mocks.finish).not.toHaveBeenCalled();
});
it("renews stale capabilities before submission without re-rendering", async () => {
	mocks.query.mockResolvedValue({
		job: { stage: "finish" },
		order,
		sources: [{ ...source, expiresAt: 0 }],
	});
	await POST(request());
	expect(mocks.mutation).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({ result: { kind: "refresh" } }),
	);
	expect(mocks.render).not.toHaveBeenCalled();
	expect(mocks.retrieve).not.toHaveBeenCalled();
});

it("resolves frozen paid instructions without a catalog request", async () => {
	const product = { subcategoryId: 103007, orderItemOptions: [39] };
	mocks.query.mockResolvedValue({
		job: { stage: "resolve", cursor: 0 },
		order: {
			...order,
			items: [{ quantity: 2 }],
			printInput: { version: 1, lines: [{ sources: [{ ...source, product }] }] },
		},
		sources: [],
	});
	await POST(request());
	expect(mocks.resolve).not.toHaveBeenCalled();
	expect(mocks.retrieve).not.toHaveBeenCalled();
	expect(mocks.mutation).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({
			result: {
				kind: "resolved",
				sources: [
					{ descriptor: source.descriptor, item: { ...source.item, quantity: 2, product } },
				],
			},
		}),
	);
});

it.each([
	{},
	{ printFulfillmentPhase: "submitting", printFulfillmentResolution: "submission_uncertain" },
	{ status: "canceled" },
	{ status: "refunded", stripeRefundId: "re_saved" },
])("finishes frozen jobs from the saved order without checkout intake: %j", async (state) => {
	const paid = {
		...order,
		...state,
		_id: "saved-order",
		printJobId: input.jobId,
		printInput: { version: 1, lines: [] },
		total: 2000,
		stripePaymentIntentId: "pi_saved",
		customerEmail: "payer@example.com",
		customerName: "Payer",
		shippingRecipientName: "Gift Recipient",
		shippingAddress: {
			line1: "123 Main",
			city: "Detroit",
			state: "MI",
			postalCode: "48201",
			country: "US",
		},
		items: [{ productName: "Print", quantity: 2, price: 2000 }],
	};
	mocks.query.mockResolvedValue({ job: { stage: "finish" }, order: paid, sources: [source] });
	mocks.directFinish.mockResolvedValue({
		fulfillment: { kind: "fulfilled" },
		notification: "none",
	});
	await POST(request());
	expect(mocks.retrieve).not.toHaveBeenCalled();
	expect(mocks.finish).not.toHaveBeenCalled();
	expect(mocks.directFinish).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({
			orderResult: { ...paid, alreadyExisted: true },
			session: expect.objectContaining({
				id: order.stripeSessionId,
				amount_total: 2000,
				payment_intent: "pi_saved",
			}),
			shippingDetails: expect.objectContaining({ name: "Gift Recipient" }),
			printJob: expect.objectContaining({ jobId: input.jobId, leaseToken: input.leaseToken }),
		}),
	);
	expect(mocks.notify).toHaveBeenCalledTimes(1);
	expect(mocks.mutation).toHaveBeenLastCalledWith(
		expect.anything(),
		expect.objectContaining({ result: { kind: "finished" } }),
	);
});
it.each([
	{ printFulfillmentPhase: "submitting" },
	{ status: "canceled" },
	{ status: "refunded", stripeRefundId: "re_saved" },
	{ status: "fulfillment_error", fulfillmentRecoveryStatus: "refund_pending" },
	{ lumaprintsOrderNumber: "10000000001" },
])("finishes a submitted or terminal order after capabilities expire: %j", async (state) => {
	mocks.query.mockResolvedValue({
		job: { stage: "finish" },
		order: { ...order, ...state },
		sources: [{ ...source, expiresAt: 0 }],
	});
	await POST(request());
	expect(mocks.finish).toHaveBeenCalledTimes(1);
	expect(mocks.issue).not.toHaveBeenCalled();
	expect(mocks.render).not.toHaveBeenCalled();
	expect(mocks.mutation).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({ result: { kind: "finished" } }),
	);
});
