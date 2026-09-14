import type { Config } from "@sveltejs/adapter-vercel";
import { json } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { createAuthenticatedConvexClient } from "$lib/server/convexClient";
import {
	diagnosePreparedPrintImage,
	readPrintDiagnosticBytes,
} from "$lib/server/printImageDiagnostic";
import {
	diagnosePreparedPrintImageInSandbox,
	sandboxDiagnosticId,
} from "$lib/server/printImageSandboxDiagnostic";
import { authorizeSiteAdminRequest } from "$lib/server/siteAdminAuthorization";

export const config = { maxDuration: 90 } satisfies Config;
const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

export async function POST({ request }: { request: Request }) {
	const url = new URL(request.url);
	if (
		url.search ||
		request.headers.get("origin") !== url.origin ||
		request.headers.get("content-type") !== "application/json"
	) {
		return json({ error: "Invalid diagnostic request" }, { status: 403, headers });
	}
	const access = await authorizeSiteAdminRequest(request);
	if (!access) return json({ error: "Unauthorized" }, { status: 401, headers });
	let payload: unknown;
	try {
		payload = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(
				await readPrintDiagnosticBytes(request.body, 512),
			),
		);
	} catch {
		return json({ error: "Invalid diagnostic request" }, { status: 400, headers });
	}
	if (
		!payload ||
		typeof payload !== "object" ||
		Array.isArray(payload) ||
		Object.keys(payload).some(
			(key) => !["orderId", "environment", "sandboxExternalId"].includes(key),
		) ||
		("environment" in payload && payload.environment !== "sandbox") ||
		("sandboxExternalId" in payload &&
			(!("environment" in payload) ||
				payload.environment !== "sandbox" ||
				typeof payload.sandboxExternalId !== "string" ||
				!sandboxDiagnosticId.test(payload.sandboxExternalId))) ||
		!("orderId" in payload) ||
		typeof payload.orderId !== "string" ||
		!/^[a-z0-9]{32}$/.test(payload.orderId)
	) {
		return json({ error: "Invalid diagnostic request" }, { status: 400, headers });
	}
	try {
		const client = createAuthenticatedConvexClient(access.convexToken);
		// Convex validates the opaque ID and independently enforces stored site membership.
		const source = await client.query(api.printImageDiagnostics.source, {
			orderId: payload.orderId as Id<"orders">,
		});
		if (!source)
			return json({ error: "Prepared diagnostic source unavailable" }, { status: 404, headers });
		if ("environment" in payload && payload.environment === "sandbox") {
			const externalId =
				"sandboxExternalId" in payload && typeof payload.sandboxExternalId === "string"
					? payload.sandboxExternalId
					: undefined;
			return json(await diagnosePreparedPrintImageInSandbox(source, externalId), { headers });
		}
		return json(await diagnosePreparedPrintImage(source), { headers });
	} catch {
		return json({ error: "Diagnostic unavailable" }, { status: 503, headers });
	}
}
