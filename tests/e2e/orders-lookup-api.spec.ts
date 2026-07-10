import { expect, test } from "@playwright/test";

test("orders lookup rejects email-bearing GET requests on the public server surface", async ({
	request,
}) => {
	const response = await request.get(
		"/api/orders/lookup?email=buyer%40example.com&orderNumber=ORD-001",
	);

	expect(response.status()).toBe(405);
	expect(response.headers()["allow"]).toBe("POST");
	await expect(response.json()).resolves.toEqual({ error: "Use POST to look up orders" });
});
