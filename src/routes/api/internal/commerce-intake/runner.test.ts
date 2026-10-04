import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	run: vi.fn(),
	env: {
		COMMERCE_INTAKE_RUNNER_SECRET: "runner-fixture-0123456789abcdef01234567",
		WEBHOOK_SECRET: "separate-webhook",
		PRINT_FULFILLMENT_RUNNER_SECRET: "separate-print",
	},
}));
vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$lib/server/commerceIntakeJob", () => ({ runCommerceIntakeStep: mocks.run }));

import { POST } from "./+server";

const body = {
	inboxId: "j1234567890123456789012345678901",
	leaseToken: "00000000-0000-4000-8000-000000000001",
};
function invoke(value: unknown = body, auth = `Bearer ${mocks.env.COMMERCE_INTAKE_RUNNER_SECRET}`) {
	const request = new Request("http://localhost/api/internal/commerce-intake", {
		method: "POST",
		headers: { authorization: auth },
		body: typeof value === "string" ? value : JSON.stringify(value),
	});
	return POST({ request } as Parameters<typeof POST>[0]);
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.env.COMMERCE_INTAKE_RUNNER_SECRET = "runner-fixture-0123456789abcdef01234567";
	mocks.run.mockReset().mockResolvedValue(undefined);
});

test("only an authenticated bounded claim reaches the runner", async () => {
	expect((await invoke()).status).toBe(200);
	expect(mocks.run).toHaveBeenCalledWith(body.inboxId, body.leaseToken);
});
test.each(["", "Bearer wrong"])("rejects unauthenticated callbacks", async (authorization) => {
	await expect(invoke(body, authorization)).rejects.toMatchObject({ status: 401 });
	expect(mocks.run).not.toHaveBeenCalled();
});
test.each([
	"WEBHOOK_SECRET",
	"PRINT_FULFILLMENT_RUNNER_SECRET",
] as const)("rejects sharing the %s capability", async (field) => {
	mocks.env.COMMERCE_INTAKE_RUNNER_SECRET = mocks.env[field].padEnd(40, "x");
	const prior = mocks.env[field];
	mocks.env[field] = mocks.env.COMMERCE_INTAKE_RUNNER_SECRET;
	try {
		await expect(invoke()).rejects.toMatchObject({ status: 503 });
	} finally {
		mocks.env[field] = prior;
	}
	expect(mocks.run).not.toHaveBeenCalled();
});
test.each([
	{ ...body, siteUrl: "other.example" },
	{ ...body, leaseToken: "invalid" },
	{ ...body, inboxId: "../../secrets" },
	"invalid",
])("rejects payloads beyond the claim identity", async (value) => {
	await expect(invoke(value)).rejects.toMatchObject({ status: 400 });
	expect(mocks.run).not.toHaveBeenCalled();
});
test("bounds bytes and sanitizes runner failures", async () => {
	await expect(invoke("é".repeat(257))).rejects.toMatchObject({ status: 413 });
	mocks.run.mockRejectedValue(new Error("buyer@example.invalid secret-provider-response"));
	await expect(invoke()).rejects.toMatchObject({
		status: 503,
		body: { message: "Commerce intake is temporarily unavailable" },
	});
});
