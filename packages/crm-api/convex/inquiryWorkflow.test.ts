/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
const siteUrl = "workflow.example.test";
async function setup() {
	const t = convexTest(schema, modules);
	await t.mutation(internal.platform.seedClient, { siteUrl, name: "Workflow", email: "owner@example.test", adminEmails: ["owner@example.test"], tier: "full", subscriptionStatus: "active", role: "client" });
	const id = await t.run((ctx) => ctx.db.insert("inquiries", { siteUrl, name: "Visitor", email: "visitor@example.test", phone: "123", subject: "Portrait session", message: "Original request", status: "new" }));
	return { t, id, admin: t.withIdentity({ subject: "owner", email: "owner@example.test", emailVerified: true }) };
}
test("creates one lead, retains the request and connects the existing CRM activity", async () => {
	const { t, id, admin } = await setup();
	const args = { id, category: "photography" as const };
	const clientId = await admin.mutation(api.inquiries.linkClient, args);
	expect(await admin.mutation(api.inquiries.linkClient, args)).toBe(clientId);
	expect(await admin.query(api.inquiries.getWorkflow, { id })).toMatchObject({ inquiry: { clientId, message: "Original request", status: "read" }, client: { name: "Visitor", status: "lead", notes: "Portrait session\n\nOriginal request" } });
	expect((await admin.query(api.activityLog.getClientActivity, { clientId }))).toMatchObject([{ action: "inquiry_linked" }]);
	expect((await admin.query(api.inquiries.listForClient, { clientId, paginationOpts: { numItems: 25, cursor: null } })).page.map((inquiry) => inquiry._id)).toEqual([id]);
	expect(await t.run((ctx) => ctx.db.query("photographyClients").take(10))).toHaveLength(1);
});
test("links an existing client without replacing their notes or booking status", async () => {
	const { t, id, admin } = await setup();
	const clientId = await t.run((ctx) => ctx.db.insert("photographyClients", { siteUrl, name: "Returning client", category: "photography", status: "booked", notes: "Keep this" }));
	await admin.mutation(api.inquiries.linkClient, { id, clientId, category: "photography" });
	expect(await t.run((ctx) => ctx.db.get(clientId))).toMatchObject({ notes: "Keep this", status: "booked" });
});
test("persists notes, pages due follow-ups by date and removes completed work from the due list", async () => {
	const { id, admin } = await setup();
	await admin.mutation(api.inquiries.updateFollowUp, { id, date: "2026-11-03", notes: "Send estimate", completed: false });
	const args = { siteUrl, followUpBefore: "2026-11-03", paginationOpts: { numItems: 25, cursor: null } };
	expect((await admin.query(api.inquiries.listPaginated, args)).page.map((inquiry) => inquiry._id)).toEqual([id]);
	expect((await admin.query(api.inquiries.listPaginated, { ...args, followUpBefore: "2026-11-02" })).page).toEqual([]);
	await expect(admin.mutation(api.inquiries.updateFollowUp, { id, date: "2026-02-30", notes: "", completed: false })).rejects.toThrow("calendar date");
	await admin.mutation(api.inquiries.updateFollowUp, { id, date: null, notes: "Estimate sent", completed: true });
	expect((await admin.query(api.inquiries.listPaginated, args)).page).toEqual([]);
	expect((await admin.query(api.inquiries.getWorkflow, { id })).inquiry).toMatchObject({ internalNotes: "Estimate sent", followUpCompletedAt: expect.any(Number) });
});
test("rejects anonymous and cross-tenant workflow access and linking", async () => {
	const { t, id, admin } = await setup();
	await expect(t.query(api.inquiries.getWorkflow, { id })).rejects.toThrow("Not authenticated");
	const foreign = await t.run((ctx) => ctx.db.insert("photographyClients", { siteUrl: "foreign.test", name: "Foreign", category: "photography", status: "lead" }));
	await expect(admin.mutation(api.inquiries.linkClient, { id, clientId: foreign, category: "photography" })).rejects.toThrow("Client not found");
	const outsider = t.withIdentity({ subject: "outsider", email: "outsider@example.test", emailVerified: true });
	await expect(outsider.query(api.inquiries.getWorkflow, { id })).rejects.toThrow("Not authorized");
	await expect(outsider.query(api.inquiries.clientOptions, { id, paginationOpts: { numItems: 25, cursor: null } })).rejects.toThrow("Not authorized");
	await expect(outsider.mutation(api.inquiries.updateFollowUp, { id, date: null, notes: "", completed: true })).rejects.toThrow("Not authorized");
});


test("CRM workflow remains unavailable to a Basic tenant", async () => {
 const { t, id, admin } = await setup();
 await t.run(async (ctx) => { const site = await ctx.db.query("platformClients").withIndex("by_siteUrl", q => q.eq("siteUrl", siteUrl)).unique(); if (!site) throw new Error("Missing tenant"); await ctx.db.patch(site._id, { tier: "basic" }); });
 await expect(admin.query(api.inquiries.getWorkflow, { id })).rejects.toThrow("Full CRM");
 await expect(admin.mutation(api.inquiries.linkClient, { id, category: "photography" })).rejects.toThrow("Full CRM");
});
