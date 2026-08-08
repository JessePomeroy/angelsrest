/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { BULK_SCAN_LIMIT } from "./helpers/limits";
import {
	classifyRefundTargetRows,
	type HistoricalRefundSelectors,
	type RefundTargetSelectors,
} from "./helpers/refundTargetClassifier";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const current: RefundTargetSelectors = {
	orderNumber: "CURRENT-ORDER",
	stripeSessionId: "cs_test_current_selector",
	stripePaymentIntentId: "pi_current_selector",
	stripeRefundId: "re_current_selector",
};

const historical: HistoricalRefundSelectors = {
	stripeSessionId: "cs_test_historical_selector",
	stripePaymentIntentId: "pi_historical_selector",
	stripeRefundId: "re_historical_selector",
	amount: 1500,
};

function row(overrides: Partial<{
	orderNumber: string;
	stripeSessionId: string;
	stripePaymentIntentId: string;
	stripeRefundId: string;
	total: number;
	status: string;
}> = {}) {
	return {
		orderNumber: current.orderNumber,
		stripeSessionId: current.stripeSessionId,
		stripePaymentIntentId: current.stripePaymentIntentId,
		stripeRefundId: current.stripeRefundId,
		total: 4200,
		status: "refunded",
		...overrides,
	};
}

const historicalRow = () => row({
	orderNumber: "HISTORICAL-ORDER",
	stripeSessionId: historical.stripeSessionId,
	stripePaymentIntentId: historical.stripePaymentIntentId,
	stripeRefundId: historical.stripeRefundId,
	total: historical.amount,
});

describe("orthogonal refund target classification", () => {
	test("retains every independent finding when one target predicate misses", () => {
		expect(classifyRefundTargetRows([
			row({ stripePaymentIntentId: "pi_different_selector" }),
		], 10, current, historical)).toEqual({
			source: "complete",
			predicates: {
				orderNumber: "unique",
				checkoutSession: "unique",
				paymentIntent: "none",
				refund: "unique",
				refundedState: "unique",
				currentIdentity: "none",
				completedRefund: "none",
			},
			historicalRelation: "neither",
		});
	});

	test("accumulates divergent predicate matches without selecting either row", () => {
		expect(classifyRefundTargetRows([
			row({
				stripePaymentIntentId: "pi_first_other",
				stripeRefundId: "re_first_other",
			}),
			row({
				orderNumber: "SECOND-ORDER",
				stripeSessionId: "cs_test_second_other",
				status: "new",
			}),
		], 10, current, historical)).toEqual({
			source: "complete",
			predicates: {
				orderNumber: "unique",
				checkoutSession: "unique",
				paymentIntent: "unique",
				refund: "unique",
				refundedState: "unique",
				currentIdentity: "none",
				completedRefund: "none",
			},
			historicalRelation: "ambiguous",
		});
	});

	test("fails closed when distinct duplicate rows match every target predicate", () => {
		expect(classifyRefundTargetRows([
			row(),
			row({ total: 4300 }),
		], 10, current, historical)).toEqual({
			source: "complete",
			predicates: {
				orderNumber: "multiple",
				checkoutSession: "multiple",
				paymentIntent: "multiple",
				refund: "multiple",
				refundedState: "multiple",
				currentIdentity: "multiple",
				completedRefund: "multiple",
			},
			historicalRelation: "ambiguous",
		});
	});

	test.each([
		["historical_only", [historicalRow()]],
		["current_only", [row()]],
		["both", [historicalRow(), row()]],
		["neither", []],
		[
			"ambiguous",
			[historicalRow(), row({
				orderNumber: "PARTIAL-HISTORICAL",
				stripeSessionId: historical.stripeSessionId,
			})],
		],
	] as const)("returns the %s historical relation class", (historicalRelation, rows) => {
		const result = classifyRefundTargetRows(rows, 10, current, historical);
		expect(result).toMatchObject({ source: "complete", historicalRelation });
	});

	test("fails closed on exactly one overflow sentinel", () => {
		expect(classifyRefundTargetRows([
			row(),
			row({ orderNumber: "SECOND" }),
			row({ orderNumber: "OVERFLOW-SENTINEL" }),
		], 2, current, historical)).toEqual({ source: "overflow" });
	});

	test("rejects an invalid source bound with one fixed error", () => {
		expect(() => classifyRefundTargetRows([], 0, current, historical)).toThrow(
			"Refund target source limit must be a positive safe integer",
		);
	});
});

const SITE_URL = "local-target.example";
const ADMIN_EMAIL = "local-target-admin@example.test";
const FOREIGN_SITE_URL = "foreign-target.example";
const FOREIGN_ADMIN_EMAIL = "foreign-target-admin@example.test";
const queryTarget = {
	orderNumber: "LOCAL-TARGET-ORDER",
	stripeSessionId: "cs_test_localtarget12345678",
	stripePaymentIntentId: "pi_localtarget12345678",
	stripeRefundId: "re_localtarget12345678",
};

function storedOrder(siteUrl = SITE_URL) {
	return {
		siteUrl,
		orderNumber: queryTarget.orderNumber,
		stripeSessionId: queryTarget.stripeSessionId,
		stripePaymentIntentId: queryTarget.stripePaymentIntentId,
		stripeRefundId: queryTarget.stripeRefundId,
		customerEmail: "local-buyer@example.test",
		items: [{ productName: "Local fixture", quantity: 1, price: 4200 }],
		total: 4200,
		fulfillmentType: "lumaprints" as const,
		status: "refunded" as const,
	};
}

async function siteAdmin(t: ReturnType<typeof convexTest>) {
	await t.run((ctx) => ctx.db.insert("platformClients", {
		name: "Local target tenant",
		email: ADMIN_EMAIL,
		siteUrl: SITE_URL,
		tier: "full",
		subscriptionStatus: "active",
		adminEmails: [ADMIN_EMAIL],
		role: "client",
	}));
	return t.withIdentity({ subject: ADMIN_EMAIL, email: ADMIN_EMAIL });
}

async function foreignSiteAdmin(t: ReturnType<typeof convexTest>) {
	await t.run((ctx) => ctx.db.insert("platformClients", {
		name: "Foreign target tenant",
		email: FOREIGN_ADMIN_EMAIL,
		siteUrl: FOREIGN_SITE_URL,
		tier: "full",
		subscriptionStatus: "active",
		adminEmails: [FOREIGN_ADMIN_EMAIL],
		role: "client",
	}));
	return t.withIdentity({
		subject: FOREIGN_ADMIN_EMAIL,
		email: FOREIGN_ADMIN_EMAIL,
	});
}

describe("refund target query boundary", () => {
	test("uses the tenant bound and returns only closed normalized classes", async () => {
		const t = convexTest(schema, modules);
		const admin = await siteAdmin(t);
		await t.run(async (ctx) => {
			await ctx.db.insert("orders", storedOrder());
			await ctx.db.insert("orders", storedOrder("other-tenant.example"));
		});

		const result = await admin.query(api.orders.classifyRefundTarget, {
			siteUrl: SITE_URL,
			target: queryTarget,
		});
		expect(result).toEqual({
			source: "complete",
			predicates: {
				orderNumber: "unique",
				checkoutSession: "unique",
				paymentIntent: "unique",
				refund: "unique",
				refundedState: "unique",
				currentIdentity: "unique",
				completedRefund: "unique",
			},
			historicalRelation: "current_only",
		});

		const serialized = JSON.stringify(result);
		for (const privateValue of [
			SITE_URL,
			ADMIN_EMAIL,
			"local-buyer@example.test",
			...Object.values(queryTarget),
		]) expect(serialized).not.toContain(privateValue);
	});

	test("rejects unauthenticated inspection and invalid selectors", async () => {
		const t = convexTest(schema, modules);
		const admin = await siteAdmin(t);
		await expect(t.query(api.orders.classifyRefundTarget, {
			siteUrl: SITE_URL,
			target: queryTarget,
		})).rejects.toThrow("Not authenticated");
		await expect(admin.query(api.orders.classifyRefundTarget, {
			siteUrl: SITE_URL,
			target: { ...queryTarget, stripeRefundId: "invalid" },
		})).rejects.toThrow("Invalid refund target selectors");
	});

	test("rejects an authenticated administrator from another tenant", async () => {
		const t = convexTest(schema, modules);
		await siteAdmin(t);
		const foreignAdmin = await foreignSiteAdmin(t);
		await t.run((ctx) => ctx.db.insert("orders", storedOrder()));

		await expect(foreignAdmin.query(api.orders.classifyRefundTarget, {
			siteUrl: SITE_URL,
			target: queryTarget,
		})).rejects.toThrow("Not authorized (not a site admin)");
	});

	test("returns only the overflow class when the tenant source has one sentinel row", async () => {
		const t = convexTest(schema, modules);
		const admin = await siteAdmin(t);
		await t.run(async (ctx) => {
			for (let index = 0; index < BULK_SCAN_LIMIT + 1; index += 1) {
				await ctx.db.insert("orders", {
					...storedOrder(),
					orderNumber: `OVERFLOW-${index}`,
				});
			}
		});

		await expect(admin.query(api.orders.classifyRefundTarget, {
			siteUrl: SITE_URL,
			target: queryTarget,
		})).resolves.toEqual({ source: "overflow" });
	});
});
