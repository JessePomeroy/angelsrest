export interface StripeConnectReadiness {
	status: "ready" | "setup_required" | "restricted" | "pending_verification";
	chargesEnabled: boolean;
	payoutsEnabled: boolean;
	detailsSubmitted: boolean;
}

export interface StripeConnectSetupData {
	siteUrl: string;
	onboardingEnabled: boolean;
	sessionStatus: "signed_out" | "unauthorized" | "authorized" | "unavailable";
	email: string | null;
	accountId: string | null;
	readiness: StripeConnectReadiness | null;
	message: string | null;
	returned: boolean;
}

export function stripeConnectSetupPath(siteUrl: string) {
	return `/portal/stripe/${encodeURIComponent(siteUrl)}`;
}
