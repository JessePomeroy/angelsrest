import { Resend } from "resend";
import { env as privateEnv } from "$env/dynamic/private";

export function getResend() {
	return new Resend(privateEnv.RESEND_API_KEY);
}

export async function sendEmail(opts: {
	to: string;
	subject: string;
	html: string;
	from?: string;
}) {
	const resend = getResend();
	return await resend.emails.send({
		from: opts.from || "Angel's Rest <noreply@angelsrest.online>",
		to: opts.to,
		subject: opts.subject,
		html: opts.html,
	});
}

export function replaceTemplateVariables(
	template: string,
	variables: Record<string, string>,
): string {
	let result = template;
	for (const [key, value] of Object.entries(variables)) {
		result = result.replaceAll(`{{${key}}}`, value);
	}
	return result;
}
