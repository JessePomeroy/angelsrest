import { json } from "@sveltejs/kit";
import { Resend } from "resend";
import { api } from "$convex/api";
import { env } from "$env/dynamic/private";
import { RESEND_API_KEY } from "$env/static/private";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";
import { trimString, validateEmail } from "$lib/server/validation";
import type { RequestHandler } from "./$types";

const resend = new Resend(RESEND_API_KEY);
const convex = getConvex();

export const POST: RequestHandler = async ({ request }) => {
	const { name, email, subject, message } = await request.json();

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

	try {
		await resend.emails.send({
			from: "contact@angelsrest.online",
			to: env.NOTIFICATION_EMAIL || "thinkingofview@gmail.com",
			subject: trimmedSubject || `Contact from ${trimmedName}`,
			text: `Name: ${trimmedName}\nEmail: ${trimmedEmail}\n\n${trimmedMessage}`,
		});

		await convex.mutation(api.inquiries.create, {
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
