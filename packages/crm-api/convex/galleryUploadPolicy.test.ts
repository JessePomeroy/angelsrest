/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("delivery gallery upload permissions", () => {
	test("grants any-file uploads only to the authenticated Angels Rest creator membership", async () => {
		const t = convexTest(schema, modules);
		for (const [siteUrl, email, role] of [
			["angelsrest.online", "owner@example.invalid", "creator"],
			["client.example", "client@example.invalid", "client"],
			["other-creator.example", "other@example.invalid", "creator"],
		] as const) {
			await t.mutation(internal.platform.seedClient, {
				name: "Upload policy fixture",
				email,
				siteUrl,
				tier: "full",
				subscriptionStatus: "active",
				adminEmails: [email],
				role,
			});
			const admin = t.withIdentity({ subject: email, email, emailVerified: true });
			await admin.mutation(api.adminAuth.claimAdminAccess, { siteUrl });
			await expect(admin.query(api.galleries.getUploadPolicy, { siteUrl })).resolves.toBe(
				siteUrl === "angelsrest.online" ? "all-files" : "media",
			);
		}

		const target = { siteUrl: "angelsrest.online" };
		await expect(t.query(api.galleries.getUploadPolicy, target)).rejects.toThrow();
		await expect(t.withIdentity({
			subject: "client@example.invalid", email: "client@example.invalid", emailVerified: true,
		}).query(api.galleries.getUploadPolicy, target)).rejects.toThrow(/Not authorized/);
		await expect(t.withIdentity({
			subject: "different-identity", email: "owner@example.invalid", emailVerified: true,
		}).query(api.galleries.getUploadPolicy, target)).rejects.toThrow(/Not authorized/);
	});

	test("does not infer owner privileges from a site name or an unmarked legacy row", async () => {
		const t = convexTest(schema, modules);
		await t.mutation(internal.platform.seedClient, {
			name: "Owner fixture", email: "owner@example.invalid", siteUrl: "angelsrest.online",
			tier: "full", subscriptionStatus: "active", adminEmails: ["owner@example.invalid"],
		});
		const owner = t.withIdentity({
			subject: "owner", email: "owner@example.invalid", emailVerified: true,
		});
		await expect(owner.query(api.galleries.getUploadPolicy, {
			siteUrl: "angelsrest.online",
		})).resolves.toBe("media");
	});
});
