/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
const runnerSecret = "synthetic-notification-runner-0123456789";
afterEach(() => {
	vi.useRealTimers();
	delete process.env.WEBHOOK_SECRET;
	delete process.env.INQUIRY_NOTIFICATION_RUNNER_SECRET;
});
async function setup() {
	vi.useFakeTimers();
	process.env.WEBHOOK_SECRET = "synthetic-webhook";
	process.env.INQUIRY_NOTIFICATION_RUNNER_SECRET = runnerSecret;
	const t = convexTest(schema, modules);
	const siteUrl = "notifications.example";
	const email = "owner@example.test";
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
	const inquiryId = await t.mutation(api.inquiries.create, {
		webhookSecret: "synthetic-webhook",
		siteUrl,
		name: "Visitor",
		email: "visitor@example.test",
		message: "Synthetic",
		notification: {
			transport: "hub",
			from: "contact@example.test",
			to: email,
			replyTo: "visitor@example.test",
			subject: "Inquiry",
			html: "<p>Synthetic</p>",
			text: "Synthetic",
		},
	});
	const job = (await t.run((ctx) => ctx.db.query("inquiryNotifications").collect()))[0];
	return { t, admin, inquiryId, job };
}
test("atomically enqueues, claims once, and ignores stale completions after a safe retry", async () => {
	const { t, admin, inquiryId, job } = await setup();
	expect(job.state).toBe("pending");
	await t.mutation(internal.inquiryNotifications.wake, { id: job._id, nextAt: job.nextAt });
	let current = await t.run((ctx) => ctx.db.get(job._id));
	const first = { id: job._id, leaseToken: current!.leaseToken!, runnerSecret };
	const dispatch = await t.query(api.inquiryNotifications.getDispatch, first);
	expect(dispatch?.idempotencyKey).toBe(`inquiry/${inquiryId}`);
	expect(
		await t.mutation(api.inquiryNotifications.authorizeSender, {
			...first,
			fingerprint: "a".repeat(64),
		}),
	).toBe(true);
	await t.mutation(api.inquiryNotifications.complete, { ...first, outcome: "uncertain" });
	current = await t.run((ctx) => ctx.db.get(job._id));
	vi.setSystemTime(current!.nextAt);
	await t.mutation(internal.inquiryNotifications.wake, { id: job._id, nextAt: current!.nextAt });
	current = await t.run((ctx) => ctx.db.get(job._id));
	const second = { ...first, leaseToken: current!.leaseToken! };
	expect((await t.query(api.inquiryNotifications.getDispatch, second))?.idempotencyKey).toBe(
		dispatch?.idempotencyKey,
	);
	await t.mutation(api.inquiryNotifications.complete, {
		...first,
		outcome: "accepted",
		providerId: "stale",
	});
	expect((await admin.query(api.inquiryNotifications.status, { inquiryId }))?.state).toBe(
		"sending",
	);
	await t.mutation(api.inquiryNotifications.complete, {
		...second,
		outcome: "accepted",
		providerId: "accepted",
	});
	expect((await admin.query(api.inquiryNotifications.status, { inquiryId }))?.state).toBe(
		"accepted",
	);
	await expect(admin.mutation(api.inquiryNotifications.retry, { inquiryId })).rejects.toThrow();
});
test("bounds attempts and the provider replay window, with membership authorization", async () => {
	const { t, admin, inquiryId, job } = await setup();
	for (let i = 0; i < 5; i++) {
		const row = await t.run((ctx) => ctx.db.get(job._id));
		vi.setSystemTime(row!.nextAt);
		await t.mutation(internal.inquiryNotifications.wake, { id: job._id, nextAt: row!.nextAt });
		const sending = await t.run((ctx) => ctx.db.get(job._id));
		await t.mutation(api.inquiryNotifications.complete, {
			id: job._id,
			leaseToken: sending!.leaseToken!,
			runnerSecret,
			outcome: "retryable",
		});
	}
	expect(await admin.query(api.inquiryNotifications.status, { inquiryId })).toMatchObject({
		state: "uncertain",
		attempts: 5,
		canRetry: true,
	});
	vi.setSystemTime(Date.now() + 24 * 60 * 60_000);
	expect((await admin.query(api.inquiryNotifications.status, { inquiryId }))?.canRetry).toBe(false);
	await expect(admin.mutation(api.inquiryNotifications.retry, { inquiryId })).rejects.toThrow();
	await expect(
		t
			.withIdentity({ subject: "stranger", email: "stranger@example.test", emailVerified: true })
			.query(api.inquiryNotifications.status, { inquiryId }),
	).rejects.toThrow();
	await expect(
		t.query(api.inquiryNotifications.getDispatch, {
			id: job._id,
			leaseToken: "x",
			runnerSecret: "wrong",
		}),
	).rejects.toThrow();
});
test("stops rather than replaying a send with a different provider credential", async () => {
	const { t, job } = await setup();
	await t.mutation(internal.inquiryNotifications.wake, { id: job._id, nextAt: job.nextAt });
	const row = await t.run((ctx) => ctx.db.get(job._id));
	const args = { id: job._id, leaseToken: row!.leaseToken!, runnerSecret };
	expect(
		await t.mutation(api.inquiryNotifications.authorizeSender, {
			...args,
			fingerprint: "a".repeat(64),
		}),
	).toBe(true);
	expect(
		await t.mutation(api.inquiryNotifications.authorizeSender, {
			...args,
			fingerprint: "b".repeat(64),
		}),
	).toBe(false);
	expect((await t.run((ctx) => ctx.db.get(job._id)))?.errorCode).toBe("sender_changed");
});
