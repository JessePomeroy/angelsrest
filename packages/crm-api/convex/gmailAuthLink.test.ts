/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { gmailScopes } from "./helpers/gmail/policy";
import schema from "./schema";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), install: vi.fn(), verified: true }));
vi.mock("./auth", () => ({
	authComponent: {
		getAuthUser: async () => ({ email: "owner@example.test", emailVerified: mocks.verified }),
		getAuth: async () => ({
			auth: { api: { refreshToken: mocks.refresh } },
			headers: new Headers({ authorization: "Bearer synthetic-session" }),
		}),
	},
	createAuth: vi.fn(),
}));
vi.mock("./gmailNode", async () => {
	const { internalAction } = await import("./_generated/server");
	const { v } = await import("convex/values");
	return {
		installLinked: internalAction({
			args: {
				siteUrl: v.string(),
				expectedAddress: v.string(),
				accessToken: v.string(),
				refreshToken: v.string(),
			},
			handler: async (_ctx, a) => {
				await mocks.install(a);
				return null;
			},
		}),
	};
});
const modules = import.meta.glob("./**/*.ts");
beforeEach(() => {
	vi.clearAllMocks();
	mocks.verified = true;
	vi.stubGlobal(
		"fetch",
		vi.fn(() => {
			throw new Error("No live requests allowed");
		}),
	);
});
afterEach(() => vi.unstubAllGlobals());
async function setup() {
	const t = convexTest(schema, modules),
		siteUrl = "linked.example.test";
	await t.run((ctx) =>
		ctx.db.insert("platformClients", {
			siteUrl,
			name: "Synthetic site",
			email: "owner@example.test",
			adminEmails: ["owner@example.test"],
			role: "client",
			tier: "full",
			subscriptionStatus: "active",
		}),
	);
	return {
		t,
		siteUrl,
		admin: t.withIdentity({ subject: "owner", email: "owner@example.test", emailVerified: true }),
	};
}
test.each([
	"new Google link",
	"existing SSO upgrade",
])("%s requires complete actual scopes and passes tokens only to the internal mailbox adapter", async () => {
	const s = await setup();
	mocks.refresh.mockResolvedValue({
		accessToken: "synthetic-access",
		refreshToken: "synthetic-refresh",
		scope: gmailScopes.join(","),
	});
	expect(await s.admin.action(api.gmailAuthLink.complete, { siteUrl: s.siteUrl })).toEqual({
		connected: true,
	});
	expect(mocks.install).toHaveBeenCalledWith({
		siteUrl: s.siteUrl,
		expectedAddress: "owner@example.test",
		accessToken: "synthetic-access",
		refreshToken: "synthetic-refresh",
	});
	expect(mocks.refresh.mock.calls[0][0].body).toEqual({ providerId: "google" });
});
test.each([
	gmailScopes.slice(0, 1).join(","),
	gmailScopes.slice(1).join(","),
	"openid,email,profile",
])("partial scope grant does not enable Gmail or change login: %s", async (scope) => {
	const s = await setup();
	mocks.refresh.mockResolvedValue({ accessToken: "synthetic", refreshToken: "synthetic", scope });
	expect(await s.admin.action(api.gmailAuthLink.complete, { siteUrl: s.siteUrl })).toEqual({
		connected: false,
	});
	expect(mocks.install).not.toHaveBeenCalled();
});
test("a signed-in foreign tenant cannot capture a linked grant for this site", async () => {
	const s = await setup();
	await expect(
		s.t
			.withIdentity({ subject: "foreign", email: "foreign@example.test", emailVerified: true })
			.action(api.gmailAuthLink.complete, { siteUrl: s.siteUrl }),
	).rejects.toThrow();
	expect(mocks.refresh).not.toHaveBeenCalled();
});
test("missing offline capability never silently enables a short-lived Gmail connection", async () => {
	const s = await setup();
	mocks.refresh.mockResolvedValue({ accessToken: "synthetic", scope: gmailScopes.join(",") });
	expect(await s.admin.action(api.gmailAuthLink.complete, { siteUrl: s.siteUrl })).toEqual({
		connected: false,
	});
	expect(mocks.install).not.toHaveBeenCalled();
});

test("SDK refresh failure crosses the action boundary with a safe stage, not token-bearing details", async () => {
	const s = await setup();
	mocks.refresh.mockRejectedValueOnce(
		new Error("synthetic-access-secret synthetic-refresh-secret"),
	);
	const failure = await s.admin
		.action(api.gmailAuthLink.complete, { siteUrl: s.siteUrl })
		.catch((error: unknown) => error);
	expect(failure).toMatchObject({ data: { code: "server_failure", stage: "refresh" } });
	expect(String(failure)).not.toContain("synthetic-");
	expect(mocks.install).not.toHaveBeenCalled();
});

test("a known install failure keeps its cause across the real internal action boundary", async () => {
	const s = await setup();
	mocks.refresh.mockResolvedValueOnce({
		accessToken: "synthetic-access",
		refreshToken: "synthetic-refresh",
		scope: gmailScopes.join(" "),
	});
	mocks.install.mockRejectedValueOnce(
		new ConvexError({ code: "account_mismatch", stage: "profile" }),
	);
	const failure = await s.admin
		.action(api.gmailAuthLink.complete, { siteUrl: s.siteUrl })
		.catch((error: unknown) => error);
	expect(failure).toMatchObject({ data: { code: "account_mismatch", stage: "profile" } });
});
