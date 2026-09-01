/** Pure, dependency-free HTML rendering for the public contact owner notification. */

export interface ContactOwnerNotificationFacts {
	name: string;
	email: string;
	subject?: string;
	message: string;
}

const HTML_ESCAPE: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

function escapeHtml(value: string) {
	return value.replace(/[&<>"']/g, (character) => HTML_ESCAPE[character] ?? character);
}

function escapedLines(value: string) {
	return value.split(/\r?\n/).map(escapeHtml).join("<br>");
}

function factRow(label: string, value: string) {
	return `<tr>
	<td class="fact-label" valign="top" style="width: 112px; padding: 11px 18px 11px 0; border-bottom: 1px solid #e2dcd3; color: #756c64; font-family: Arial, Helvetica, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.07em; line-height: 1.45; text-transform: uppercase;">${escapeHtml(label)}</td>
	<td class="fact-value" valign="top" style="padding: 11px 0; border-bottom: 1px solid #e2dcd3; color: #2f2a26; font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.55; overflow-wrap: anywhere; word-break: break-word;">${escapedLines(value)}</td>
</tr>`;
}

/** Render the private owner notification for a durable public contact inquiry. */
export function renderContactOwnerNotificationHtml(input: ContactOwnerNotificationFacts) {
	const name = escapeHtml(input.name);
	const preheader = escapeHtml(`New contact inquiry from ${input.name}.`);
	const message = escapedLines(input.message);

	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="x-apple-disable-message-reformatting">
	<meta name="color-scheme" content="light dark">
	<meta name="supported-color-schemes" content="light dark">
	<title>New contact inquiry · Angel's Rest</title>
	<style>
		@media only screen and (max-width: 640px) {
			.email-shell { width: 100% !important; }
			.section { padding-left: 24px !important; padding-right: 24px !important; }
			.hero-title { font-size: 34px !important; }
			.fact-label, .fact-value { display: block !important; width: 100% !important; box-sizing: border-box !important; }
			.fact-label { padding: 14px 0 3px !important; border-bottom: 0 !important; }
			.fact-value { padding: 0 0 14px !important; }
		}
		@media (prefers-color-scheme: dark) {
			.email-page { background: #211d1a !important; }
			.email-shell { background: #302a26 !important; }
			.email-shell h1, .email-shell strong { color: #f3eee7 !important; }
			.email-shell p, .email-shell td { color: #d1c8bd !important; }
			.email-shell, .email-shell td { border-color: #514740 !important; }
			.email-shell .message-cell { background: #403832 !important; color: #f0e8df !important; }
		}
	</style>
</head>
<body class="email-page" style="margin: 0; padding: 0; background: #f1eee8; -webkit-text-size-adjust: 100%;">
	<div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent; mso-hide: all;">${preheader}</div>
	<table class="email-page" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f1eee8" style="width: 100%; background: #f1eee8;">
		<tr>
			<td align="center" style="padding: 34px 14px 46px;">
				<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
				<table class="email-shell" role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" bgcolor="#fbfaf7" style="width: 100%; max-width: 600px; table-layout: fixed; background: #fbfaf7; border: 1px solid #ddd6cc; overflow-wrap: anywhere; word-break: break-word;">
					<tr>
						<td class="section" style="padding: 30px 48px 26px; border-bottom: 1px solid #ddd6cc; color: #40362f; font-family: Arial, Helvetica, sans-serif; font-size: 12px; font-weight: 600; letter-spacing: 0.14em; line-height: 1; text-transform: uppercase;">Angel's Rest</td>
					</tr>
					<tr>
						<td class="section" style="padding: 40px 48px 38px;">
							<p style="margin: 0 0 14px; color: #756c64; font-family: Arial, Helvetica, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.13em; line-height: 1.4; text-transform: uppercase;">Contact form</p>
							<h1 class="hero-title" style="margin: 0; max-width: 500px; color: #2f2a26; font-family: Georgia, 'Times New Roman', serif; font-size: 42px; font-weight: 400; letter-spacing: -0.035em; line-height: 1.08;">A new message arrived.</h1>
							<p style="margin: 20px 0 0; max-width: 520px; color: #5f5750; font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 1.7; overflow-wrap: anywhere; word-break: break-word;">${name} sent a message through the Angel's Rest contact form.</p>
						</td>
					</tr>
					<tr>
						<td class="section" style="padding: 2px 48px 38px; border-top: 1px solid #ddd6cc;">
							<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width: 100%; table-layout: fixed;">
								${factRow("Name", input.name)}
								${factRow("Email", input.email)}
								${factRow("Subject", input.subject || "No subject provided")}
							</table>
						</td>
					</tr>
					<tr>
						<td class="section" style="padding: 34px 48px 40px; border-top: 1px solid #ddd6cc;">
							<p style="margin: 0 0 14px; color: #756c64; font-family: Arial, Helvetica, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; line-height: 1.4; text-transform: uppercase;">Message</p>
							<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width: 100%; table-layout: fixed;">
								<tr>
									<td class="message-cell" bgcolor="#f2ede6" style="padding: 20px 22px; border-left: 3px solid #8b6f5b; color: #403a35; font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.7; overflow-wrap: anywhere; word-break: break-word;">${message}</td>
								</tr>
							</table>
						</td>
					</tr>
					<tr>
						<td class="section" style="padding: 28px 48px 34px; border-top: 1px solid #ddd6cc;">
							<p style="margin: 0; color: #5f5750; font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.65; overflow-wrap: anywhere; word-break: break-word;">Reply to this email to respond to ${name}. The submitted address is already set as the reply destination.</p>
					</td>
					</tr>
				</table>
				<!--[if mso]></td></tr></table><![endif]-->
			</td>
		</tr>
	</table>
</body>
</html>`;
}
