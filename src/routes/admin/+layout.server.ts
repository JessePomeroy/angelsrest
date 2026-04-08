import type { Tier } from "@jessepomeroy/admin";

export async function load(): Promise<{ tier: Tier; isCreator: boolean }> {
	// angelsrest is the creator's site — always full tier
	// when extracted to the admin package, client sites will query Convex:
	//   const { tier } = await convex.query(api.platform.checkTier, { siteUrl })
	return {
		tier: "full",
		isCreator: true,
	};
}
