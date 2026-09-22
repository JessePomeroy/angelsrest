import { error } from "@sveltejs/kit";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	env: {
		CLIENT_PRINT_REFUNDS_ENABLED: "true",
		CLIENT_REFUND_EVIDENCE_ENABLED: "true",
		WEBHOOK_SECRET: "secret",
	},
	auth: vi.fn(),
	query: vi.fn(),
	mutation: vi.fn(),
	run: vi.fn(),
	stripe: vi.fn(),
	client: vi.fn(),
}));
vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$lib/server/adminAuth", () => ({ requireAuth: mocks.auth }));
vi.mock("$lib/server/convexClient", () => ({ createAuthenticatedConvexClient: mocks.client }));
vi.mock("$lib/server/clientPrintRefunds.server", async (original) => ({
	...(await original<typeof import("$lib/server/clientPrintRefunds.server")>()),
	runClientPrintRefund: mocks.run,
	getClientPrintRefundStripe: mocks.stripe,
}));

import { actions, load } from "./+page.server";

function event(fields: Record<string, string> = {}, origin = "https://hub.example") {
	return {
		params: { siteUrl: "client.example" },
		cookies: {},
		setHeaders: vi.fn(),
		url: new URL("https://hub.example/portal/refunds/client.example?order=order1"),
		request: new Request("https://hub.example/portal/refunds/client.example", {
			method: "POST",
			headers: { origin },
			body: new URLSearchParams({
				intent: "request",
				orderId: "order1",
				requestToken: "123e4567-e89b-42d3-a456-426614174000",
				line_0: "40.01",
				line_1: "10",
				other: "5",
				confirmed: "yes",
				...fields,
			}),
		}),
	} as unknown as Parameters<typeof load>[0];
}
const action = (input = event()) => actions.default(input as Parameters<typeof actions.default>[0]);
beforeEach(() => {
	vi.resetAllMocks();
	mocks.env.CLIENT_PRINT_REFUNDS_ENABLED = "true";
	mocks.auth.mockResolvedValue("verified-session");
	mocks.client.mockReturnValue({ query: mocks.query, mutation: mocks.mutation });
	mocks.query.mockResolvedValue({
		siteUrl: "client.example",
		selected: { lines: [{ index: 0 }, { index: 1 }] },
	});
	mocks.mutation.mockResolvedValue("operation1");
	mocks.run.mockResolvedValue(undefined);
});
test("disabled load authenticates but does not call an undeployed backend", async () => {
	mocks.env.CLIENT_PRINT_REFUNDS_ENABLED = "false";
	expect(await load(event())).toMatchObject({ enabled: false, page: null });
	expect(mocks.query).not.toHaveBeenCalled();
});
test("signed out redirects to the existing sign-in page", async () => {
	mocks.auth.mockImplementation(() => error(401, "Unauthorized"));
	await expect(load(event())).rejects.toMatchObject({
		status: 303,
		location: "/portal/stripe/client.example",
	});
	expect(mocks.query).not.toHaveBeenCalled();
});
test("membership denial reveals no order data", async () => {
	mocks.query.mockRejectedValue(new Error("private database detail"));
	await expect(load(event())).rejects.toMatchObject({ status: 403 });
});
test("requires same origin and enabled flag before creating a request", async () => {
	expect(await action(event({}, "https://foreign.example"))).toMatchObject({ status: 503 });
	mocks.env.CLIENT_PRINT_REFUNDS_ENABLED = "false";
	expect(await action()).toMatchObject({ status: 503 });
	expect(mocks.mutation).not.toHaveBeenCalled();
	expect(mocks.run).not.toHaveBeenCalled();
});
test("uses authoritative line count and exact integer cents", async () => {
	await expect(action()).rejects.toMatchObject({ status: 303 });
	expect(mocks.client).toHaveBeenCalledWith("verified-session");
	expect(mocks.mutation).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({
			allocation: { lineAmountsCents: [4001, 1000], otherAmountCents: 500 },
		}),
	);
	expect(mocks.run).toHaveBeenCalledOnce();
});
test.each<Record<string, string>>([
	{ line_0: "1e2" },
	{ line_0: "0.001" },
	{ line_0: "-1" },
	{ confirmed: "no" },
	{ line_0: "" },
])("rejects malformed allocation %j", async (fields) => {
	expect(await action(event(fields))).toMatchObject({ status: 400 });
	expect(mocks.mutation).not.toHaveBeenCalled();
});
test("provider failure returns to durable operation status", async () => {
	mocks.run.mockRejectedValue(new Error("private provider failure"));
	await expect(action()).rejects.toMatchObject({
		status: 303,
		location: "/portal/refunds/client.example?order=order1",
	});
	expect(mocks.mutation).toHaveBeenCalledOnce();
});
test("retry checks current client ownership before invoking the worker", async () => {
	mocks.query.mockRejectedValue(new Error("Not authorized"));
	expect(await action(event({ intent: "retry", operationId: "foreign" }))).toMatchObject({
		status: 503,
	});
	expect(mocks.run).not.toHaveBeenCalled();
});
test("cancel checks ownership and never calls Stripe", async () => {
	mocks.query.mockResolvedValue({ orderId: "order1" });
	await expect(
		action(event({ intent: "cancel", operationId: "operation1" })),
	).rejects.toMatchObject({ status: 303 });
	expect(mocks.mutation).toHaveBeenCalledOnce();
	expect(mocks.stripe).not.toHaveBeenCalled();
});
test("bounds the body before parsing or calling backend", async () => {
	expect(await action(event({ extra: "x".repeat(17000) }))).toMatchObject({ status: 413 });
	expect(mocks.query).not.toHaveBeenCalled();
});
