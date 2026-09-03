import { expect, test } from "@playwright/test";

test("R4 closure state rejects an unauthenticated public request", async ({ request }) => {
	const response = await request.get("/api/admin/commerce/closure-state");
	expect(response.status()).toBe(401);
});

test("R4 public Shop catalog sentinel rejects an unauthenticated public request", async ({
	request,
}) => {
	const response = await request.get("/api/admin/commerce/shop-catalog-sentinel");
	expect(response.status()).toBe(401);
});
