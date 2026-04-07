export const FEATURES = {
	// Basic tier — included for all
	dashboard: "basic",
	orders: "basic",
	inquiries: "basic",
	galleries: "basic",

	// Full tier — requires CRM subscription
	crm: "full",
	invoicing: "full",
	quotes: "full",
	contracts: "full",
	emails: "full",
	messages: "full",
} as const;

export type Feature = keyof typeof FEATURES;
export type Tier = "basic" | "full";

const TIER_RANK: Record<Tier, number> = {
	basic: 0,
	full: 1,
};

export function hasFeature(tier: Tier, feature: Feature): boolean {
	const required = FEATURES[feature];
	return TIER_RANK[tier] >= TIER_RANK[required];
}

export function getFullFeatures(): Feature[] {
	return Object.entries(FEATURES)
		.filter(([, tier]) => tier === "full")
		.map(([feature]) => feature as Feature);
}
