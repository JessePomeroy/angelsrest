/** Public failure vocabulary only; never add provider payloads or credentials. */
const codes = [
	"consent_declined",
	"missing_permissions",
	"account_mismatch",
	"intent_expired",
	"mailbox_unavailable",
	"connection_busy",
	"server_failure",
] as const;
const stages = ["intent", "consent", "refresh", "exchange", "profile", "watch", "install"] as const;
export type GmailConnectionCode = (typeof codes)[number];
export type GmailConnectionStage = (typeof stages)[number];
export type GmailConnectionFailure = { code: GmailConnectionCode; stage: GmailConnectionStage };

export function connectionCode(value: unknown): GmailConnectionCode | null {
	return codes.find((code) => code === value) ?? null;
}

export function connectionFailureData(value: unknown): GmailConnectionFailure | null {
	if (!value || typeof value !== "object" || !("code" in value) || !("stage" in value)) return null;
	const code = connectionCode(value.code);
	const stage = stages.find((stage) => stage === value.stage);
	return code && stage ? { code, stage } : null;
}
