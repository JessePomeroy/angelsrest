/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const WEBHOOK_SECRET = "test-webhook-secret";

beforeEach(() => {
	process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
});

afterEach(() => {
	delete process.env.WEBHOOK_SECRET;
});

describe("inquiry creation boundary", () => {
	test("accepts and strips the shared server webhook secret", async () => {
		const t = convexTest(schema, modules);

		const inquiryId = await t.mutation(api.inquiries.create, {
			webhookSecret: WEBHOOK_SECRET,
			siteUrl: "tenant.example",
			name: "Example Person",
			email: "person@example.com",
			message: "Hello",
		});

		const inquiry = await t.run(async (ctx) => await ctx.db.get(inquiryId));
		expect(inquiry).toMatchObject({ name: "Example Person", status: "new" });
		expect(inquiry).not.toHaveProperty("webhookSecret");
	});

	test("rejects direct callers that omit the shared secret", async () => {
		const t = convexTest(schema, modules);
		const argsWithoutSecret = {
			siteUrl: "tenant.example",
			name: "Direct Caller",
			email: "direct@example.com",
			message: "Bypass attempt",
		};

		await expect(
			t.mutation(api.inquiries.create, argsWithoutSecret as never),
		).rejects.toThrow("Missing required field `webhookSecret`");
	});

	test("rejects direct callers with the wrong secret", async () => {
		const t = convexTest(schema, modules);

		await expect(
			t.mutation(api.inquiries.create, {
				webhookSecret: "wrong-secret",
				siteUrl: "tenant.example",
				name: "Example Person",
				email: "person@example.com",
				message: "Hello",
			}),
		).rejects.toThrow("Not authorized (webhook secret mismatch)");
	});
});
