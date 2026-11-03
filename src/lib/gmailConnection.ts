import {
	connectionCode,
	type GmailConnectionCode,
} from "../../packages/crm-api/src/gmailConnection";

const messages: Record<GmailConnectionCode, string> = {
	consent_declined:
		"Google permission was canceled or declined. Gmail was not enabled. You can start again when you want to connect it.",
	missing_permissions:
		"Gmail needs read, send and offline access. Return to Google connections and approve those permissions for the intended account.",
	account_mismatch:
		"The Google account does not match this connection. For a sign-in upgrade, choose your admin login email. To use another mailbox, choose connect a separate business Gmail.",
	intent_expired:
		"This connection request expired or was already used. Start a fresh request from Google connections; do not reload the old callback.",
	mailbox_unavailable:
		"This mailbox cannot be connected to this site. Ask your administrator to check the approved mailbox and its existing site association.",
	connection_busy:
		"Another connection operation is still finishing. Check Gmail status before starting another request.",
	server_failure:
		"The server could not finish the Gmail connection. This does not mean you declined permission. Check Gmail status and give your administrator the reference below if shown; repeating Google consent may not resolve this failure.",
};

export function connectionMessage(value: unknown) {
	return messages[connectionCode(value) ?? "server_failure"];
}

export function googleCallbackCode(error: string | null): GmailConnectionCode {
	if (error === "access_denied") return "consent_declined";
	if (error === "email_doesn't_match" || error === "account_already_linked_to_different_user")
		return "account_mismatch";
	return "server_failure";
}

export function connectionReference(value: unknown): string | null {
	return typeof value === "string" &&
		/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
		? value
		: null;
}

export function connectionReturnPath(value: unknown) {
	if (typeof value !== "string" || !value.startsWith("/")) return "/admin/inquiries";
	try {
		const url = new URL(value, "https://local.invalid");
		return url.origin === "https://local.invalid" &&
			["/admin/inquiries", "/admin/crm"].includes(url.pathname)
			? url.pathname + url.search
			: "/admin/inquiries";
	} catch {
		return "/admin/inquiries";
	}
}
