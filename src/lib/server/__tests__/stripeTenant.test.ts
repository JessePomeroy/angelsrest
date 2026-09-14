import { describe, expect, it, vi } from "vitest";
import { buildTenantCheckoutOptions } from "../stripeConnect";
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

		const tenant = await resolveStripeTenantForSite("https://www.angelsrest.online", { lookup });
		expect(tenant).toEqual({
			tenantId,
			siteUrl: "angelsrest.online",
			name: undefined,
			stripeConnectedAccountId: undefined,
		});
		expect(lookup).toHaveBeenCalledWith("angelsrest.online");
		expect(
			buildTenantCheckoutOptions({ tenant, kind: "print", subtotalCents: 1_000 }).metadata,
		).toEqual({
			commerceTenantSiteUrl: "angelsrest.online",
			commerceTenantId: tenantId,
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
