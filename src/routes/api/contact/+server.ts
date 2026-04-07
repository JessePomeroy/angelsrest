import { Resend } from "resend";
import { RESEND_API_KEY } from "$env/static/private";
import { adminClient } from "$lib/sanity/adminClient";
import type { RequestHandler } from "./$types";

const resend = new Resend(RESEND_API_KEY);

export const POST: RequestHandler = async ({ request }) => {
	const { name, email, subject, message } = await request.json();

	if (!name || !email || !message) {
		return new Response(JSON.stringify({ error: "Missing required fields" }), {
			status: 400,
		});
	}

	try {
		// Send email via Resend
		await resend.emails.send({
			from: "contact@angelsrest.online",
			to: "thinkingofview@gmail.com",
			subject: subject || `Contact from ${name}`,
			text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
		});

		// Create inquiry document in Sanity
		await adminClient.create({
			_type: "inquiry",
			name,
			email,
			subject: subject || null,
			message,
			status: "new",
			submittedAt: new Date().toISOString(),
		});

		return new Response(JSON.stringify({ success: true }), { status: 200 });
	} catch (err) {
		console.error("Contact form error:", err);
		return new Response(JSON.stringify({ error: "Failed to send" }), {
			status: 500,
		});
	}
};
