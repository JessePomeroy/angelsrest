/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { CLIENT_FEATURES, clientFeatureAllowed, resolveClientFeatures } from "../src/clientFeatures";

const modules = import.meta.glob("./**/*.ts");
const identity = (subject: string) => ({ subject, issuer: "https://fixture.example", email: `${subject}@example.test`, emailVerified: true });

async function fixture(tier: "basic" | "full" = "full") {
	const t = convexTest(schema, modules);
	const clientId = await t.run(async (ctx) => {
		await ctx.db.insert("platformClients", { name: "Operator", email: "operator@example.test", siteUrl: "angelsrest.online", tier: "full", role: "creator", subscriptionStatus: "none", adminEmails: ["operator@example.test"] });
		return ctx.db.insert("platformClients", { name: "Fixture client", email: "owner@example.test", siteUrl: "fixture.example", tier, role: "client", subscriptionStatus: "none", adminEmails: ["owner@example.test"] });
	});
	return { t, clientId, operator: t.withIdentity(identity("operator")), owner: t.withIdentity(identity("owner")) };
}

describe("shared client tier policy", () => {
 test("Basic and Full automatically include their complete bundles", () => {
  expect(resolveClientFeatures({ tier: "basic", role: "client" })).toEqual(["dashboard", "editor", "orders", "inquiries", "galleries"]);
  expect(resolveClientFeatures({ tier: "full", role: "client" })).toEqual(Object.keys(CLIENT_FEATURES).filter(feature => feature !== "messages"));
  expect(clientFeatureAllowed({ tier: "basic" }, "invoicing")).toBe(false);
  expect(clientFeatureAllowed({ tier: "full", role: "client" }, "messages")).toBe(false);
  expect(clientFeatureAllowed({ tier: "full", role: "creator" }, "messages")).toBe(true);
 });
 test("only the creator can change a client's tier", async () => {
  const { t, owner } = await fixture("basic");
  const update = { siteUrl: "fixture.example", tier: "full" as const, subscriptionStatus: "none" as const };
  await expect(t.mutation(api.platform.updateSubscription, update)).rejects.toThrow();
  await expect(owner.mutation(api.platform.updateSubscription, update)).rejects.toThrow();
 });
 test("a tier change updates effective access and direct backend permissions together", async () => {
  const { t, operator, owner } = await fixture("basic");
  const args = { siteUrl: "fixture.example", name: "Recipient", category: "photography" as const };
  await expect(owner.mutation(api.crm.createClient, args)).rejects.toThrow("plan");
  await operator.mutation(api.platform.updateSubscription, { siteUrl: args.siteUrl, tier: "full", subscriptionStatus: "none" });
  expect(await t.query(api.platform.getFeatureAccess, { siteUrl: args.siteUrl })).toMatchObject({ tier: "full", enabledFeatures: expect.arrayContaining(["crm", "invoicing", "galleryDelivery"]) });
  expect(await owner.query(api.adminAuth.checkAdminAccess, { siteUrl: args.siteUrl, email: "owner@example.test" })).toMatchObject({ authorized: true, tier: "full", enabledFeatures: expect.arrayContaining(["crm", "invoicing", "galleryDelivery"]) });
  expect(await owner.mutation(api.crm.createClient, args)).toBeTruthy();
 });
 test("a previously issued quote remains readable and actionable after a tier downgrade", async () => {
  const { t, operator, owner } = await fixture();
  const recipient = await owner.mutation(api.crm.createClient, { siteUrl: "fixture.example", name: "Recipient", category: "photography" });
  const quote = await owner.mutation(api.quotes.create, { siteUrl: "fixture.example", clientId: recipient, packages: [{ name: "Session", price: 30000 }] });
  await owner.mutation(api.quotes.markSent, { siteUrl: "fixture.example", quoteId: quote });
  const token = await owner.mutation(api.portal.createToken, { siteUrl: "fixture.example", clientId: recipient, documentId: quote, type: "quote" });
  await operator.mutation(api.platform.updateSubscription, { siteUrl: "fixture.example", tier: "basic", subscriptionStatus: "none" });
  expect(await t.query(api.portal.getPublicByToken, { token })).toMatchObject({ expired: false });
  await t.mutation(api.portal.acceptQuote, { token });
  expect(await t.query(api.portal.getPublicByToken, { token })).toMatchObject({ document: { status: "accepted" } });
  await expect(owner.mutation(api.portal.createToken, { siteUrl: "fixture.example", clientId: recipient, documentId: quote, type: "quote" })).rejects.toThrow("plan");
 });
 test("gallery recipients keep viewing, proofing and downloads after a tier downgrade", async () => {
  const { t, operator, owner } = await fixture();
  const siteUrl = "fixture.example";
  const recipient = await owner.mutation(api.crm.createClient, { siteUrl, name: "Recipient", category: "photography" });
  const galleryId = await owner.mutation(api.galleries.create, { siteUrl, clientId: recipient, name: "Portraits", slug: "portraits", downloadEnabled: true, favoritesEnabled: true });
  const imageId = await owner.mutation(api.galleries.addImage, { siteUrl, galleryId, filename: "portrait.jpg", r2Key: `${siteUrl}/${galleryId}/original/portrait.jpg`, sizeBytes: 100, width: 100, height: 100 });
  await owner.mutation(api.galleries.update, { id: galleryId, siteUrl, status: "published" });
  const token = await owner.mutation(api.portal.createToken, { siteUrl, clientId: recipient, type: "gallery", documentId: galleryId });
  await operator.mutation(api.platform.updateSubscription, { siteUrl, tier: "basic", subscriptionStatus: "none" });
  expect((await t.query(api.galleries.getImagesPage, { galleryId, token, cursor: null })).page).toHaveLength(1);
  expect(await t.query(api.galleries.getImage, { galleryId, imageId, token })).toMatchObject({ _id: imageId });
  await t.mutation(api.galleries.updateImage, { id: imageId, token, isFavorite: true });
  await t.mutation(api.galleries.submitProof, { galleryId, token, expectedRound: 0, notes: "Keep this photograph" });
  expect(await t.query(api.portal.getPublicByToken, { token })).toMatchObject({ expired: false, document: { downloadEnabled: true } });
  await expect(owner.mutation(api.galleries.create, { siteUrl, clientId: recipient, name: "Blocked", slug: "blocked", downloadEnabled: true, favoritesEnabled: true })).rejects.toThrow("Full gallery access");
 });
});
