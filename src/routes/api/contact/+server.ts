import { json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { env } from "$env/dynamic/private";
import { ADMIN_EMAIL, SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";
import { getResend } from "$lib/server/resendClient";
import { verifyTurnstileToken } from "$lib/server/turnstile";
import { trimString, validateEmail } from "$lib/server/validation";
import type { RequestHandler } from "./$types";

const convex = getConvex();

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const resend = getResend();
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: "Invalid JSON" }, { status: 400 });
	}

	if (!body || typeof body !== "object") {
		return json({ error: "Invalid request body" }, { status: 400 });
	}

	const payload = body as Record<string, unknown>;
	const name = typeof payload.name === "string" ? payload.name : undefined;
	const email = typeof payload.email === "string" ? payload.email : undefined;
	const subject = typeof payload.subject === "string" ? payload.subject : undefined;
	const message = typeof payload.message === "string" ? payload.message : undefined;

	const trimmedName = trimString(name, 255);
	const trimmedEmail = trimString(email, 255);
	const trimmedSubject = trimString(subject, 255);
	const trimmedMessage = trimString(message, 5000);

	if (!trimmedName || !trimmedEmail || !trimmedMessage) {
		return json({ error: "Missing required fields" }, { status: 400 });
	}

	if (!validateEmail(trimmedEmail)) {
		return json({ error: "Invalid email format" }, { status: 400 });
	}

	const webhookSecret = env.WEBHOOK_SECRET;
	if (!webhookSecret) {
		console.error("[contact] WEBHOOK_SECRET is not configured");
		return json({ error: "Contact form is temporarily unavailable" }, { status: 503 });
	}

	const verification = await verifyTurnstileToken({
		token: payload["cf-turnstile-response"],
		remoteIp: getClientAddress(),
	});
	if (!verification.success) {
		const status = verification.reason === "unavailable" ? 503 : 403;
		return json({ error: "Verification failed" }, { status });
	}

	try {
		await resend.emails.send({
			from: "contact@angelsrest.online",
			to: env.NOTIFICATION_EMAIL || ADMIN_EMAIL,
			subject: trimmedSubject || `Contact from ${trimmedName}`,
			text: `Name: ${trimmedName}\nEmail: ${trimmedEmail}\n\n${trimmedMessage}`,
		});

		await convex.mutation(api.inquiries.create, {
			webhookSecret,
			siteUrl: SITE_DOMAIN,
			name: trimmedName,
			email: trimmedEmail,
			subject: trimmedSubject || undefined,
			message: trimmedMessage,
		});

		return json({ success: true });
	} catch (err) {
		console.error("Contact form error:", err);
		return json({ error: "Failed to send" }, { status: 500 });
	}
};
