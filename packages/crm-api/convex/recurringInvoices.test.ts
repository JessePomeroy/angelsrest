/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { recurringDate } from "./helpers/recurringCalendar";
const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.useRealTimers());
async function setup() {
	vi.useFakeTimers();
	vi.setSystemTime(Date.parse("2027-01-01T12:00:00Z"));
	const t = convexTest(schema, modules);
	const siteUrl = "recurring.example",
		email = "owner@example.test";
	await t.run((ctx) =>
		ctx.db.insert("platformClients", {
			siteUrl,
			email,
			name: "Synthetic",
			tier: "full",
			subscriptionStatus: "active",
			adminEmails: [email],
			role: "client",
		}),
	);
	const admin = t.withIdentity({ subject: email, email, emailVerified: true });
	const clientId = await admin.mutation(api.crm.createClient, {
		siteUrl,
		name: "Synthetic Client",
		email: "client@example.test",
		category: "photography",
		type: "portrait",
	});
	const invoiceId = await admin.mutation(api.invoices.create, {
		siteUrl,
		clientId,
		invoiceType: "recurring",
		items: [{ description: "Synthetic service", quantity: 1, unitPrice: 2500 }],
		recurring: { interval: "monthly", nextDueDate: "2020-01-01", endDate: "2027-03-31" },
	});
	return { t, admin, siteUrl, invoiceId };
}
test("clamps short months without drifting, including leap-day and quarterly anchors", () => {
	expect(recurringDate("2027-01-31", "monthly", 1)).toBe("2027-02-28");
	expect(recurringDate("2027-01-31", "monthly", 2)).toBe("2027-03-31");
	expect(recurringDate("2028-02-29", "yearly", 1)).toBe("2029-02-28");
	expect(recurringDate("2028-02-29", "yearly", 4)).toBe("2032-02-29");
	expect(recurringDate("2027-01-31", "quarterly", 1)).toBe("2027-04-30");
	expect(() => recurringDate("2027-02-31", "monthly", 1)).toThrow();
});
test("requires activation, creates exactly one draft per calendar cycle, and completes at the inclusive end date", async () => {
	const { t, admin, siteUrl, invoiceId } = await setup();
	expect(await admin.query(api.recurringInvoices.get, { siteUrl, invoiceId })).toBeNull();
	await expect(
		admin.mutation(api.recurringInvoices.activate, {
			siteUrl,
			invoiceId,
			firstDueDate: "2020-01-01",
		}),
	).rejects.toThrow();
	const id = await admin.mutation(api.recurringInvoices.activate, {
		siteUrl,
		invoiceId,
		firstDueDate: "2027-01-31",
	});
	await expect(
		admin.mutation(api.recurringInvoices.activate, {
			siteUrl,
			invoiceId,
			firstDueDate: "2027-01-31",
		}),
	).rejects.toThrow();
	for (const date of ["2027-01-31", "2027-02-28", "2027-03-31"]) {
		vi.setSystemTime(Date.parse(`${date}T00:00:00Z`));
		await t.mutation(internal.recurringInvoices.wake, { id, expectedDate: date });
		await t.mutation(internal.recurringInvoices.wake, { id, expectedDate: date });
	}
	const rows = await t.run((ctx) => ctx.db.query("invoices").collect());
	const generated = rows.filter((row) => row.recurringScheduleId === id);
	expect(generated).toHaveLength(3);
	expect(new Set(rows.map((row) => row.invoiceNumber)).size).toBe(4);
	expect(
		generated.every(
			(row) =>
				row.status === "draft" &&
				!row.sentAt &&
				!row.stripeCheckoutSessionId &&
				row.paidAmount === undefined,
		),
	).toBe(true);
	expect((await admin.query(api.recurringInvoices.get, { siteUrl, invoiceId }))?.state).toBe(
		"completed",
	);
	await expect(admin.mutation(api.invoices.remove, { siteUrl, invoiceId })).rejects.toThrow(
		"history must be retained",
	);
});
test("pause blocks queued wakes, resume skips missed dates, cancellation is terminal, and foreign admins cannot change it", async () => {
	const { t, admin, siteUrl, invoiceId } = await setup();
	const id = await admin.mutation(api.recurringInvoices.activate, {
		siteUrl,
		invoiceId,
		firstDueDate: "2027-01-31",
	});
	await admin.mutation(api.recurringInvoices.changeState, { siteUrl, invoiceId, state: "paused" });
	vi.setSystemTime(Date.parse("2027-03-01T12:00:00Z"));
	await t.mutation(internal.recurringInvoices.wake, { id, expectedDate: "2027-01-31" });
	await admin.mutation(api.recurringInvoices.changeState, { siteUrl, invoiceId, state: "active" });
	expect(await admin.query(api.recurringInvoices.get, { siteUrl, invoiceId })).toMatchObject({
		nextDueDate: "2027-03-31",
		cycle: 2,
	});
	await expect(
		t
			.withIdentity({ subject: "stranger", email: "stranger@example.test", emailVerified: true })
			.mutation(api.recurringInvoices.changeState, { siteUrl, invoiceId, state: "canceled" }),
	).rejects.toThrow();
	await admin.mutation(api.recurringInvoices.changeState, {
		siteUrl,
		invoiceId,
		state: "canceled",
	});
	await expect(
		admin.mutation(api.recurringInvoices.changeState, { siteUrl, invoiceId, state: "active" }),
	).rejects.toThrow();
	expect(await t.run((ctx) => ctx.db.query("invoices").collect())).toHaveLength(1);
});
