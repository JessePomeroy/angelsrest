import { expect, test } from "@playwright/test";

test("cart page ignores legacy v1 persisted carts", async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.setItem(
			"angelsrest:cart:v1",
			JSON.stringify({
				items: [
					{
						id: "legacy-item",
						productSlug: "old-print",
						type: "print",
						title: "old print",
						imageUrl: "https://example.com/old.jpg",
						paperName: "Archival Matte",
						paperSubcategoryId: 103001,
						paperWidth: 8,
						paperHeight: 10,
						quantity: 1,
						unitPriceCents: 100,
					},
				],
				updatedAt: new Date().toISOString(),
			}),
		);
	});

	await page.goto("/cart");

	await expect(page.getByRole("heading", { name: "your cart" })).toBeVisible();
	await expect(page.getByText("your cart is empty")).toBeVisible();
});
