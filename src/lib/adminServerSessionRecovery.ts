export interface AdminServerSessionRecoveryInput {
	hasBrowser: boolean;
	hasAuthClient: boolean;
	sessionPending: boolean;
	sessionEmail: string | null | undefined;
	serverAuthorized: boolean;
	refreshAttempted: boolean;
	refreshInFlight: boolean;
}

function hasSettledClientSession(input: AdminServerSessionRecoveryInput): boolean {
	return input.hasAuthClient && !input.sessionPending && Boolean(input.sessionEmail);
}

export function shouldRefreshAdminServerSession(input: AdminServerSessionRecoveryInput): boolean {
	return (
		input.hasBrowser &&
		hasSettledClientSession(input) &&
		!input.serverAuthorized &&
		!input.refreshAttempted &&
		!input.refreshInFlight
	);
}

export function shouldHoldAdminShellForServerSession(
	input: Pick<
		AdminServerSessionRecoveryInput,
		"hasAuthClient" | "sessionPending" | "sessionEmail" | "serverAuthorized"
	>,
): boolean {
	return (
		input.hasAuthClient &&
		!input.sessionPending &&
		Boolean(input.sessionEmail) &&
		!input.serverAuthorized
	);
}
