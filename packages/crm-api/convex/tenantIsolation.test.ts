/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const WEBHOOK_SECRET = "test-webhook-secret";

beforeEach(() => {
	process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
});

afterEach(() => {
	delete process.env.WEBHOOK_SECRET;
});

const TENANT_A = {
	name: "Tenant A",
	email: "admin-a@example.com",
	siteUrl: "tenant-a.example",
	adminEmail: "admin-a@example.com",
};

const TENANT_B = {
	name: "Tenant B",
	email: "admin-b@example.com",
	siteUrl: "tenant-b.example",
	adminEmail: "admin-b@example.com",
};

async function seedTenants() {
	const t = convexTest(schema, modules);
	await t.mutation(internal.platform.seedClient, {
		name: TENANT_A.name,
		email: TENANT_A.email,
		siteUrl: TENANT_A.siteUrl,
		tier: "full",
		subscriptionStatus: "active",
		adminEmails: [TENANT_A.adminEmail],
		role: "client",
	});
	await t.mutation(internal.platform.seedClient, {
		name: TENANT_B.name,
		email: TENANT_B.email,
		siteUrl: TENANT_B.siteUrl,
		tier: "full",
		subscriptionStatus: "active",
		adminEmails: [TENANT_B.adminEmail],
		role: "client",
	});
	return t;
}

function asAdmin(
	t: Awaited<ReturnType<typeof seedTenants>>,
	email: string,
) {
	return t.withIdentity({
		subject: email,
		email,
	});
}

async function expectNotAuthorized(promise: Promise<unknown>) {
	await expect(promise).rejects.toThrow(/Not authorized/);
}

describe("tenant isolation", () => {
	test("siteUrl-scoped queries only allow that site's admins", async () => {
		const t = await seedTenants();
		await t.mutation(api.inquiries.create, {
			webhookSecret: WEBHOOK_SECRET,
			siteUrl: TENANT_A.siteUrl,
			name: "A inquiry",
			email: "customer-a@example.com",
			message: "Tenant A only",
		});
		await t.mutation(api.inquiries.create, {
			webhookSecret: WEBHOOK_SECRET,
			siteUrl: TENANT_B.siteUrl,
			name: "B inquiry",
			email: "customer-b@example.com",
			message: "Tenant B only",
		});

		const tenantAInquiries = await asAdmin(t, TENANT_A.adminEmail).query(
			api.inquiries.list,
			{ siteUrl: TENANT_A.siteUrl },
		);
		expect(tenantAInquiries).toHaveLength(1);
		expect(tenantAInquiries[0]?.name).toBe("A inquiry");

		await expectNotAuthorized(
			asAdmin(t, TENANT_A.adminEmail).query(api.inquiries.list, {
				siteUrl: TENANT_B.siteUrl,
			}),
		);
	});

	test("document-id reads and writes are guarded by the owning site", async () => {
		const t = await seedTenants();
		const tenantA = asAdmin(t, TENANT_A.adminEmail);
		const tenantB = asAdmin(t, TENANT_B.adminEmail);
		const clientId = await tenantA.mutation(api.crm.createClient, {
			siteUrl: TENANT_A.siteUrl,
			name: "Tenant A client",
			email: "client-a@example.com",
			category: "photography",
			type: "portrait",
		});

		await expectNotAuthorized(
			tenantB.query(api.crm.getClient, { clientId }),
		);
		await expectNotAuthorized(
			tenantB.mutation(api.crm.updateClient, {
				clientId,
				siteUrl: TENANT_A.siteUrl,
				name: "Cross-tenant overwrite",
			}),
		);

		const afterAttempt = await tenantA.query(api.crm.getClient, { clientId });
		expect(afterAttempt.name).toBe("Tenant A client");
	});

	test("related CRM modules keep document ownership tenant-scoped", async () => {
		const t = await seedTenants();
		const tenantA = asAdmin(t, TENANT_A.adminEmail);
		const tenantB = asAdmin(t, TENANT_B.adminEmail);
		const clientId = await tenantA.mutation(api.crm.createClient, {
			siteUrl: TENANT_A.siteUrl,
			name: "Tenant A related client",
			email: "related-a@example.com",
			category: "photography",
			type: "portrait",
		});

		const templateId = await tenantA.mutation(api.emailTemplates.create, {
			siteUrl: TENANT_A.siteUrl,
			name: "Tenant A follow-up",
			category: "follow-up",
			subject: "hello",
			body: "body",
		});
		const tagId = await tenantA.mutation(api.tags.createTag, {
			siteUrl: TENANT_A.siteUrl,
			name: "VIP",
		});
		const quoteId = await tenantA.mutation(api.quotes.create, {
			siteUrl: TENANT_A.siteUrl,
			quoteNumber: "Q-1",
			clientId,
			packages: [{ name: "Portrait", price: 100 }],
		});
		const galleryId = await tenantA.mutation(api.galleries.create, {
			siteUrl: TENANT_A.siteUrl,
			clientId,
			name: "Tenant A gallery",
			slug: "tenant-a-gallery",
			downloadEnabled: true,
			favoritesEnabled: true,
		});

		await expectNotAuthorized(
			tenantB.query(api.emailTemplates.get, { templateId }),
		);
		await expectNotAuthorized(tenantB.mutation(api.tags.deleteTag, { tagId }));
		await expectNotAuthorized(tenantB.query(api.quotes.get, { quoteId }));
		await expectNotAuthorized(tenantB.query(api.galleries.get, { id: galleryId }));

		await expectNotAuthorized(
			tenantB.query(api.emailTemplates.list, { siteUrl: TENANT_A.siteUrl }),
		);
		await expectNotAuthorized(
			tenantB.query(api.tags.listTags, { siteUrl: TENANT_A.siteUrl }),
		);
		await expectNotAuthorized(
			tenantB.query(api.quotes.list, { siteUrl: TENANT_A.siteUrl }),
		);
		await expectNotAuthorized(
			tenantB.query(api.galleries.listBySite, { siteUrl: TENANT_A.siteUrl }),
		);
	});

	test("gallery image admin reads and cleanup keys are tenant-scoped and paginated", async () => {
		const t = await seedTenants();
		const tenantA = asAdmin(t, TENANT_A.adminEmail);
		const tenantB = asAdmin(t, TENANT_B.adminEmail);
		const clientId = await tenantA.mutation(api.crm.createClient, {
			siteUrl: TENANT_A.siteUrl,
			name: "Tenant A gallery client",
			email: "gallery-client-a@example.com",
			category: "photography",
			type: "portrait",
		});
		const galleryId = await tenantA.mutation(api.galleries.create, {
			siteUrl: TENANT_A.siteUrl,
			clientId,
			name: "Tenant A cleanup gallery",
			slug: "tenant-a-cleanup-gallery",
			downloadEnabled: true,
			favoritesEnabled: true,
		});
		for (const filename of ["one.jpg", "two.jpg", "three.jpg"]) {
			await tenantA.mutation(api.galleries.addImage, {
				siteUrl: TENANT_A.siteUrl,
				galleryId,
				r2Key: `${TENANT_A.siteUrl}/${galleryId}/original/${filename}`,
				filename,
				sizeBytes: 100,
				width: 120,
				height: 80,
			});
		}

		const adminImages = await tenantA.query(api.galleries.getImages, { galleryId });
		expect(adminImages.map((image) => image.filename)).toEqual([
			"one.jpg",
			"two.jpg",
			"three.jpg",
		]);

		await expectNotAuthorized(
			tenantB.query(api.galleries.getImages, { galleryId }),
		);
		await expectNotAuthorized(
			tenantB.query(api.galleries.listImageStorageKeys, {
				galleryId,
				paginationOpts: { numItems: 2, cursor: null },
			}),
		);

		const firstPage = await tenantA.query(api.galleries.listImageStorageKeys, {
			galleryId,
			paginationOpts: { numItems: 2, cursor: null },
		});
		expect(firstPage.keys).toEqual([
			`${TENANT_A.siteUrl}/${galleryId}/original/one.jpg`,
			`${TENANT_A.siteUrl}/${galleryId}/original/two.jpg`,
		]);
		expect(firstPage.isDone).toBe(false);

		const secondPage = await tenantA.query(api.galleries.listImageStorageKeys, {
			galleryId,
			paginationOpts: { numItems: 2, cursor: firstPage.continueCursor },
		});
		expect(secondPage.keys).toEqual([
			`${TENANT_A.siteUrl}/${galleryId}/original/three.jpg`,
		]);
		expect(secondPage.isDone).toBe(true);
	});

	test("kanban mutations cannot move another tenant's cards", async () => {
		const t = await seedTenants();
		const tenantA = asAdmin(t, TENANT_A.adminEmail);
		const tenantB = asAdmin(t, TENANT_B.adminEmail);
		const clientId = await tenantA.mutation(api.crm.createClient, {
			siteUrl: TENANT_A.siteUrl,
			name: "Tenant A board card",
			category: "photography",
			type: "portrait",
		});
		await tenantA.mutation(api.kanban.initializeBoard, {
			siteUrl: TENANT_A.siteUrl,
			projectType: "portrait",
		});

		await expectNotAuthorized(
			tenantB.mutation(api.kanban.moveCard, {
				clientId,
				siteUrl: TENANT_A.siteUrl,
				targetColumnId: "any-column",
				targetPosition: 0,
			}),
		);
	});

	test("creator-only platform queries are not available to client admins", async () => {
		const t = await seedTenants();
		await t.mutation(internal.platform.seedClient, {
			name: "Creator",
			email: "creator@example.com",
			siteUrl: "angelsrest.online",
			tier: "full",
			subscriptionStatus: "active",
			adminEmails: ["creator@example.com"],
			role: "creator",
		});
		await asAdmin(t, TENANT_A.adminEmail).mutation(api.messages.send, {
			siteUrl: TENANT_A.siteUrl,
			sender: "client",
			content: "tenant message",
		});

		await expectNotAuthorized(
			asAdmin(t, TENANT_A.adminEmail).query(api.messages.allThreads, {}),
		);

		const threads = await asAdmin(t, "creator@example.com").query(
			api.messages.allThreads,
			{},
		);
		expect(threads).toHaveLength(1);
		expect(threads[0]?.client.siteUrl).toBe(TENANT_A.siteUrl);
	});

	test("message pages start at the active end and remain tenant-scoped", async () => {
		const t = await seedTenants();
		const tenantA = asAdmin(t, TENANT_A.adminEmail);
		const tenantB = asAdmin(t, TENANT_B.adminEmail);

		for (const content of ["first", "second", "third"]) {
			await tenantA.mutation(api.messages.send, {
				siteUrl: TENANT_A.siteUrl,
				sender: "client",
				content,
			});
		}

		const firstPage = await tenantA.query(api.messages.listPaginated, {
			siteUrl: TENANT_A.siteUrl,
			paginationOpts: { numItems: 2, cursor: null },
		});
		expect(firstPage.page.map((message) => message.content)).toEqual([
			"third",
			"second",
		]);
		expect(firstPage.isDone).toBe(false);

		const secondPage = await tenantA.query(api.messages.listPaginated, {
			siteUrl: TENANT_A.siteUrl,
			paginationOpts: { numItems: 2, cursor: firstPage.continueCursor },
		});
		expect(secondPage.page.map((message) => message.content)).toEqual(["first"]);
		expect(secondPage.isDone).toBe(true);

		await expectNotAuthorized(
			tenantB.query(api.messages.listPaginated, {
				siteUrl: TENANT_A.siteUrl,
				paginationOpts: { numItems: 2, cursor: null },
			}),
		);
	});

	test("creator message threads paginate across clients", async () => {
		const t = await seedTenants();
		await t.mutation(internal.platform.seedClient, {
			name: "Creator",
			email: "creator@example.com",
			siteUrl: "angelsrest.online",
			tier: "full",
			subscriptionStatus: "active",
			adminEmails: ["creator@example.com"],
			role: "creator",
		});
		for (const tenant of [TENANT_A, TENANT_B]) {
			await asAdmin(t, tenant.adminEmail).mutation(api.messages.send, {
				siteUrl: tenant.siteUrl,
				sender: "client",
				content: `${tenant.name} message`,
			});
		}

		await expectNotAuthorized(
			asAdmin(t, TENANT_A.adminEmail).query(api.messages.allThreadsPaginated, {
				paginationOpts: { numItems: 1, cursor: null },
			}),
		);

		const creator = asAdmin(t, "creator@example.com");
		let cursor: string | null = null;
		const siteUrls: string[] = [];
		let isDone = false;
		while (!isDone) {
			const page: {
				page: Array<{ client: { siteUrl: string } }>;
				continueCursor: string;
				isDone: boolean;
			} = await creator.query(api.messages.allThreadsPaginated, {
				paginationOpts: { numItems: 1, cursor },
			});
			siteUrls.push(...page.page.map((thread) => thread.client.siteUrl));
			cursor = page.continueCursor;
			isDone = page.isDone;
		}

		expect(siteUrls.sort()).toEqual([
			TENANT_A.siteUrl,
			TENANT_B.siteUrl,
		]);
	});

	test("raw table smoke check keeps tenant fixtures independent", async () => {
		const t = await seedTenants();
		const counts = await t.run(async (ctx) => {
			const rows = await ctx.db.query("platformClients").collect();
			return rows.reduce<Record<string, number>>((acc, row) => {
				acc[row.siteUrl] = (acc[row.siteUrl] ?? 0) + 1;
				return acc;
			}, {});
		});

		expect(counts[TENANT_A.siteUrl]).toBe(1);
		expect(counts[TENANT_B.siteUrl]).toBe(1);
	});
});
