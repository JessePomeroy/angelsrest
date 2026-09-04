import { describe, expect, it, vi } from "vitest";
import { resolveStripeTenantForSite } from "../stripeTenant";

describe("resolveStripeTenantForSite", () => {
	it("returns the connected account from the platform client row", async () => {
		const lookup = vi.fn().mockResolvedValue({
			siteUrl: "zippymiggy.com",
			name: "Reflecting Pool",
			stripeConnectedAccountId: "acct_123",
		});

		await expect(resolveStripeTenantForSite("zippymiggy.com", { lookup })).resolves.toEqual({
			siteUrl: "zippymiggy.com",
			name: "Reflecting Pool",
			stripeConnectedAccountId: "acct_123",
		});
		expect(lookup).toHaveBeenCalledWith("zippymiggy.com");
	});

	it("retains a claimed tenant identity for new checkout metadata", async () => {
		const tenantId = "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b";
		const lookup = vi.fn().mockResolvedValue({ tenantId, siteUrl: "angelsrest.online" });

		await expect(resolveStripeTenantForSite("angelsrest.online", { lookup })).resolves.toEqual({
			tenantId,
			siteUrl: "angelsrest.online",
			name: undefined,
			stripeConnectedAccountId: undefined,
		});
	});

	it("falls back to direct platform checkout when no tenant row is required", async () => {
		const lookup = vi.fn().mockResolvedValue(null);

		await expect(resolveStripeTenantForSite("angelsrest.online", { lookup })).resolves.toEqual({
			siteUrl: "angelsrest.online",
		});
	});

	it("can fail closed for spoke checkout cutover", async () => {
		const lookup = vi.fn().mockResolvedValue(null);

		await expect(
			resolveStripeTenantForSite("zippymiggy.com", {
				lookup,
				requirePlatformClient: true,
			}),
		).rejects.toThrow("No platform client found for zippymiggy.com");
	});
});
