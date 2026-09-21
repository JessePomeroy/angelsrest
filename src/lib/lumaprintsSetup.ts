export interface LumaPrintsSetupChoice {
	connectionRef: string;
	storeId: number;
	environment: "sandbox" | "production";
}

export interface LumaPrintsSetupData {
	siteUrl: string;
	clientName: string;
	status:
		| "disabled"
		| "unauthorized"
		| "unavailable"
		| "unconfigured"
		| "available"
		| "connected"
		| "historical";
	choices: LumaPrintsSetupChoice[];
	connection: LumaPrintsSetupChoice | null;
}

export function lumaprintsSetupPath(siteUrl: string) {
	// Platform records can retain a full URL; setup routes carry only the tenant domain.
	const hostname = new URL(siteUrl.includes("://") ? siteUrl : `https://${siteUrl}`).hostname
		.toLowerCase()
		.replace(/^www\./, "");
	return `/admin/platform/lumaprints/${encodeURIComponent(hostname)}`;
}
