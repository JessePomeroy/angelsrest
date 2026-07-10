import type { InquiryUI } from "@jessepomeroy/admin";
import { getToken } from "@mmailaender/convex-better-auth-svelte/sveltekit";
import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { createAuthenticatedConvexClient } from "$lib/server/convexClient";

export async function load({ parent, cookies }): Promise<{ inquiries: InquiryUI[] }> {
	const { adminSession } = await parent();
	if (adminSession.status !== "authorized") return { inquiries: [] };

	let inquiries: InquiryUI[] = [];
	try {
		const token = getToken(cookies);
		if (!token) throw new Error("Missing admin session token");
		const convex = createAuthenticatedConvexClient(token);
		const raw = await convex.query(api.inquiries.list, {
			siteUrl: SITE_DOMAIN,
		});
		// Convex returns `_creationTime` (ms since epoch) — the admin
		// package expects `submittedAt` (ISO string). Map here rather than
		// widening InquiryUI to accept both shapes.
		inquiries = raw.map((row) => ({
			_id: row._id,
			name: row.name,
			email: row.email,
			phone: row.phone,
			subject: row.subject ?? null,
			message: row.message,
			status: row.status,
			submittedAt: new Date(row._creationTime).toISOString(),
		}));
	} catch (err) {
		console.error("Failed to fetch inquiries:", err);
	}

	return {
		inquiries,
	};
}
