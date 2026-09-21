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
	return `/admin/platform/lumaprints/${encodeURIComponent(siteUrl)}`;
}
