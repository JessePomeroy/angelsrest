import type { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "$convex/api";
import { env } from "$env/dynamic/private";
import type { LumaPrintsSetupChoice, LumaPrintsSetupData } from "$lib/lumaprintsSetup";
import { createLumaPrintsClient } from "$lib/server/lumaprints";
import {
	configuredLumaPrintsConnectionsForTenant,
	type LumaPrintsConnection,
	resolveLumaPrintsWebhookConfiguration,
} from "$lib/server/lumaprintsConnections";
import { normalizeCommerceTenantSiteUrl } from "$lib/server/stripeConnect";
import { getWebhookSecret } from "$lib/server/webhookSecret";

export const isLumaPrintsSetupEnabled = () => env.LUMAPRINTS_CLIENT_SETUP_ENABLED === "true";

export class LumaPrintsSetupError extends Error {
	constructor(
		readonly status: 400 | 403 | 409 | 413 | 503,
		message: string,
	) {
		super(message);
	}
}

function choice({
	connectionRef,
	storeId,
	environment,
}: LumaPrintsConnection): LumaPrintsSetupChoice {
	return { connectionRef, storeId, environment };
}

export function emptyLumaPrintsSetupData(
	siteUrl: string,
	status: LumaPrintsSetupData["status"],
): LumaPrintsSetupData {
	return { siteUrl, clientName: "", status, choices: [], connection: null };
}

export function requireLumaPrintsSetupSite(value: string) {
	if (!value || value.length > 253 || value !== value.trim() || !/^[a-z0-9.-]+$/i.test(value)) {
		throw new LumaPrintsSetupError(400, "Choose a valid client website.");
	}
	return normalizeCommerceTenantSiteUrl(value);
}

export function normalizeLumaPrintsSetupError(cause: unknown) {
	if (cause instanceof LumaPrintsSetupError) return cause;
	if (cause instanceof ConvexError && cause.data === "LUMAPRINTS_SETUP_FORBIDDEN") {
		return new LumaPrintsSetupError(403, "Only the Angels Rest operator can set up suppliers.");
	}
	if (cause instanceof ConvexError && cause.data === "LUMAPRINTS_SETUP_NOT_CLIENT") {
		return new LumaPrintsSetupError(400, "Choose a client website to set up its supplier.");
	}
	return new LumaPrintsSetupError(
		503,
		"Supplier setup is unavailable. Review the connection configuration and try again.",
	);
}

export async function loadLumaPrintsSetup(
	convex: ConvexHttpClient,
	site: string,
): Promise<LumaPrintsSetupData> {
	const siteUrl = requireLumaPrintsSetupSite(site);
	if (!isLumaPrintsSetupEnabled()) return emptyLumaPrintsSetupData(siteUrl, "disabled");
	const target = await convex.query(api.platform.getLumaPrintsSetupTarget, { siteUrl });
	if (target.connection)
		return {
			siteUrl: target.siteUrl,
			clientName: target.name,
			status: "connected",
			choices: [],
			connection: choice(target.connection),
		};
	if (target.hasHistory)
		return { ...emptyLumaPrintsSetupData(target.siteUrl, "historical"), clientName: target.name };
	const choices = configuredLumaPrintsConnectionsForTenant(target.tenantId).map(choice);
	return {
		siteUrl: target.siteUrl,
		clientName: target.name,
		status: choices.length ? "available" : "unconfigured",
		choices,
		connection: null,
	};
}

export async function verifyAndRegisterLumaPrintsConnection(
	convex: ConvexHttpClient,
	input: {
		siteUrl: string;
		connectionRef: string;
		accountOwnershipConfirmed: boolean;
		billingConfirmed: boolean;
	},
) {
	if (!isLumaPrintsSetupEnabled())
		throw new LumaPrintsSetupError(503, "Client supplier setup is not open yet.");
	const siteUrl = requireLumaPrintsSetupSite(input.siteUrl);
	const target = await convex.query(api.platform.getLumaPrintsSetupTarget, { siteUrl });
	if (!input.accountOwnershipConfirmed || !input.billingConfirmed) {
		throw new LumaPrintsSetupError(
			400,
			"Confirm client account ownership and supplier billing before connecting.",
		);
	}
	if (
		(target.connection && target.connection.connectionRef !== input.connectionRef) ||
		(!target.connection && target.hasHistory)
	) {
		throw new LumaPrintsSetupError(
			409,
			"Changing or reconnecting a supplier needs a separate operator review.",
		);
	}
	const connection = configuredLumaPrintsConnectionsForTenant(target.tenantId).find(
		(entry) => entry.connectionRef === input.connectionRef,
	);
	if (!connection)
		throw new LumaPrintsSetupError(400, "Choose a configured supplier connection for this client.");
	if (
		target.connection &&
		(target.connection.storeId !== connection.storeId ||
			target.connection.environment !== connection.environment)
	) {
		throw new LumaPrintsSetupError(
			409,
			"The configured supplier does not match the saved connection.",
		);
	}
	const webhookSecret = getWebhookSecret();
	// Require independently configured shipment authentication before saving a new supplier.
	resolveLumaPrintsWebhookConfiguration(connection.connectionRef);
	const provider = createLumaPrintsClient(connection);
	await provider.verifyStoreAccess();
	return await convex.mutation(api.platform.registerVerifiedLumaPrintsConnection, {
		clientId: target.clientId,
		tenantId: target.tenantId,
		connectionRef: connection.connectionRef,
		storeId: connection.storeId,
		environment: connection.environment,
		accountOwnershipConfirmed: true,
		billingConfirmed: true,
		webhookSecret,
	});
}

/** The native operator form has three fields; reject excess input before allocating form data. */
export async function readLumaPrintsSetupForm(request: Request) {
	if (request.headers.get("origin") !== new URL(request.url).origin) {
		throw new LumaPrintsSetupError(403, "Open supplier setup on this website to continue.");
	}
	if (
		request.headers.get("content-type")?.split(";")[0]?.trim() !==
		"application/x-www-form-urlencoded"
	) {
		throw new LumaPrintsSetupError(400, "Invalid supplier setup form.");
	}
	const reader = request.body?.getReader();
	if (!reader) throw new LumaPrintsSetupError(400, "Complete the supplier setup form.");
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > 4096) {
			void reader.cancel().catch(() => undefined);
			throw new LumaPrintsSetupError(413, "Supplier setup form is too large.");
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	let body: string;
	try {
		body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new LumaPrintsSetupError(400, "Invalid supplier setup form.");
	}
	const values = new URLSearchParams(body);
	const fields = ["connectionRef", "accountOwnershipConfirmed", "billingConfirmed"];
	if (
		[...values.keys()].some((key) => !fields.includes(key)) ||
		fields.some((key) => values.getAll(key).length > 1)
	) {
		throw new LumaPrintsSetupError(400, "Invalid supplier setup form.");
	}
	return {
		connectionRef: values.get("connectionRef") ?? "",
		accountOwnershipConfirmed: values.get("accountOwnershipConfirmed") === "on",
		billingConfirmed: values.get("billingConfirmed") === "on",
	};
}
