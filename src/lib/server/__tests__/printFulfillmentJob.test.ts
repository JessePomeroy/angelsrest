import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	mutation: vi.fn(),
	render: vi.fn(),
	store: vi.fn(),
	issue: vi.fn(),
	finish: vi.fn(),
	retrieve: vi.fn(),
	env: { PRINT_FULFILLMENT_RUNNER_SECRET: "r".repeat(40), WEBHOOK_SECRET: "webhook-test-secret" },
}));
vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$lib/server/convexClient", () => ({ getConvex: () => mocks }));
vi.mock("$lib/server/catalogCommerceClients", () => ({
	issueTenantPrintSource: mocks.issue,
	issueTenantPrintSourceCapability: mocks.issue,
	storePrintArtifact: mocks.store,
}));
vi.mock("$lib/server/printSourcePreparation", () => ({ renderPrintSource: mocks.render }));
vi.mock("$lib/server/snapshotFulfillment", () => ({ resolveSnapshotPrintSources: vi.fn() }));
vi.mock("$lib/server/orderIntake", () => ({ handleCheckoutCompleted: mocks.finish }));
vi.mock("$lib/server/commerceTenant", () => ({
	resolveStoredCommerceTenant: async () => ({ siteUrl: "angelsrest.online" }),
}));
vi.mock("$lib/server/stripeClient", () => ({
	getStripe: () => ({ checkout: { sessions: { retrieve: mocks.retrieve } } }),
}));
vi.mock("$lib/server/resendClient", () => ({ getResend: () => ({}) }));
vi.mock("$lib/server/logger", () => ({ logStructured: vi.fn() }));

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
it("reconciles a submitted order even after source capabilities expire", async () => {
	mocks.query.mockResolvedValue({
		job: { stage: "finish" },
		order: { ...order, printFulfillmentPhase: "submitting" },
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
