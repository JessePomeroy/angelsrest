import { error, isHttpError, json, type RequestEvent } from "@sveltejs/kit";
import { env } from "$env/dynamic/public";
import { adminConfig } from "$lib/config/admin";
import { type PlatformClientIntent, parseClientSetupPlan } from "$lib/platformClientSetup";
import { requireAuthWithIdentity } from "$lib/server/adminAuth";
import { createAuthenticatedConvexClient } from "$lib/server/convexClient";
import { getSiteAdminAccess } from "$lib/server/siteAdminAuthorization";
import { normalizePlatformClientInput } from "../../../packages/crm-api/convex/helpers/platformClientInput";

export const clientSetupHeaders = {
	"cache-control": "private, no-store",
	"referrer-policy": "no-referrer",
};

async function readInput(request: Request): Promise<unknown> {
	const reader = request.body?.getReader();
	if (!reader) error(400, "Check the client details.");
	const chunks: Uint8Array[] = [];
	let length = 0;
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		length += value.byteLength;
		if (length > 32_768) {
			await reader.cancel();
			error(413, "The setup request is too large.");
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		error(400, "Check the client details.");
	}
}

export async function prepareClientSetupRequest({
	cookies,
	request,
	url,
}: Pick<RequestEvent, "cookies" | "request" | "url">) {
	if (request.headers.get("origin") !== url.origin) error(403, "Request origin is not allowed.");
	const { token, identity } = await requireAuthWithIdentity(cookies);
	if (!identity.email || !(await getSiteAdminAccess(token, identity.email))?.authorized)
		error(403, "Platform administrator access is required.");
	if (adminConfig.siteUrl !== "angelsrest.online") error(403, "Client setup belongs to the hub.");
	const body = await readInput(request);
	if (
		!body ||
		typeof body !== "object" ||
		!("name" in body) ||
		typeof body.name !== "string" ||
		!("email" in body) ||
		typeof body.email !== "string" ||
		!("siteUrl" in body) ||
		typeof body.siteUrl !== "string" ||
		!("tier" in body) ||
		(body.tier !== "basic" && body.tier !== "full")
	)
		error(400, "Check the client details.");
	let normalized: ReturnType<typeof normalizePlatformClientInput>;
	try {
		normalized = normalizePlatformClientInput({
			name: body.name,
			email: body.email,
			siteUrl: body.siteUrl,
			adminEmails: [body.email],
		});
	} catch {
		error(400, "Check the client details.");
	}
	const plan = "setupPlan" in body ? parseClientSetupPlan(body.setupPlan) : null;
	if ("setupPlan" in body && !plan) error(400, "Load a prepared client setup plan.");
	// The attachment constrains this request. It never selects a backend or grants access.
	if (
		plan &&
		(plan.identity.siteUrl !== normalized.siteUrl ||
			plan.target.convexUrl !== env.PUBLIC_CONVEX_URL ||
			plan.target.convexSiteUrl !== env.PUBLIC_CONVEX_SITE_URL)
	)
		error(409, "The setup plan does not match this website and hub backend.");
	const input = {
		name: normalized.name,
		email: normalized.email,
		siteUrl: normalized.siteUrl,
		tier: body.tier,
	} satisfies PlatformClientIntent;
	return {
		input,
		statusInput: {
			...input,
			...(plan?.identity.expectedTenantId
				? { expectedTenantId: plan.identity.expectedTenantId }
				: {}),
		},
		client: createAuthenticatedConvexClient(token),
	};
}

export function clientSetupError(cause: unknown) {
	if (isHttpError(cause))
		return json(
			{ error: cause.body.message },
			{ status: cause.status, headers: clientSetupHeaders },
		);
	// Exception bodies can contain submitted details or credentials.
	return json(
		{ error: "Client setup could not be confirmed. Check its status before trying again." },
		{ status: 500, headers: clientSetupHeaders },
	);
}
