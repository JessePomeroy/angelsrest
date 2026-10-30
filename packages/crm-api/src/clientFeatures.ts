export const CLIENT_FEATURES = {
	dashboard: { label: "Dashboard", tier: "basic" },
	editor: { label: "Site editor", tier: "basic" },
	orders: { label: "Orders", tier: "basic" },
	inquiries: { label: "Inquiries", tier: "basic" },
	galleries: { label: "Portfolio galleries", tier: "basic" },
	galleryDelivery: { label: "Gallery delivery", tier: "full" },
	crm: { label: "Client management", tier: "full" },
	board: { label: "Project board", tier: "full" },
	invoicing: { label: "Invoicing", tier: "full" },
	quotes: { label: "Quotes", tier: "full" },
	contracts: { label: "Contracts", tier: "full" },
	emails: { label: "Email templates", tier: "full" },
	messages: { label: "Platform messages", tier: "full" },
} as const;

export type ClientFeature = keyof typeof CLIENT_FEATURES;
export type ClientFeaturePolicy = {
	tier: "basic" | "full";
	role?: "creator" | "client";
};

export function clientFeatureAllowed(policy: ClientFeaturePolicy, feature: ClientFeature): boolean {
	if (CLIENT_FEATURES[feature].tier === "full" && policy.tier !== "full") return false;
	return feature !== "messages" || policy.role === "creator";
}

export function resolveClientFeatures(policy: ClientFeaturePolicy) {
	return (Object.keys(CLIENT_FEATURES) as ClientFeature[]).filter((feature) => clientFeatureAllowed(policy, feature));
}

export const DOCUMENT_FEATURES = { invoice: "invoicing", quote: "quotes", contract: "contracts", gallery: "galleryDelivery" } as const;
