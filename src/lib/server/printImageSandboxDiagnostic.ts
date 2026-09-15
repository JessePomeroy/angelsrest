import { createHash } from "node:crypto";
import { env } from "$env/dynamic/private";
import { issueTenantPrintSourceCapability } from "$lib/server/catalogCommerceClients";
import { normalizeLumaPrintsProviderNumber } from "$lib/server/lumaprintsProviderNumber";
import {
	diagnosePreparedPrintImage,
	type PrintImageDiagnosticReport,
	readPrintDiagnosticBytes,
} from "$lib/server/printImageDiagnostic";
import type { LumaPrintsOrder } from "$lib/shop/types";

const sandboxOrigin = "https://us.api-sandbox.lumaprints.com";
export const sandboxDiagnosticId =
	/^ar-sandbox-prepared-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

/** Separate credentials; never fall back to the live fulfillment configuration. */
export function sandboxDiagnosticConfiguration() {
	const apiKey = env.LUMAPRINTS_SANDBOX_API_KEY;
	const apiSecret = env.LUMAPRINTS_SANDBOX_API_SECRET;
	const rawStoreId = env.LUMAPRINTS_SANDBOX_STORE_ID;
	const storeId = rawStoreId && /^[1-9]\d*$/.test(rawStoreId) ? Number(rawStoreId) : 0;
	if (
		!apiKey ||
		!apiSecret ||
		!/^[\x21-\x7e]{1,512}$/.test(apiKey) ||
		!/^[\x21-\x7e]{1,512}$/.test(apiSecret) ||
		apiKey.includes(":") ||
		!Number.isSafeInteger(storeId) ||
		storeId <= 0 ||
		apiKey === env.LUMAPRINTS_API_KEY ||
		apiSecret === env.LUMAPRINTS_API_SECRET
	)
		throw new Error("Sandbox diagnostic is not configured");
	return { baseUrl: sandboxOrigin, apiKey, apiSecret, storeId } as const;
}

type Source = Parameters<typeof diagnosePreparedPrintImage>[0];
type SandboxOrderReport = {
	outcome: "not_submitted" | "queued" | "rejected" | "unknown";
	status?: number;
	orderNumber?: string;
	imageUrlSha256?: string;
};
type SandboxReport = {
	version: 1;
	environment: "sandbox";
	image?: PrintImageDiagnosticReport;
	order: SandboxOrderReport;
};

/** Operator-only sandbox probe, not a fulfillment/retry path. Never mutates Convex. */
export async function diagnosePreparedPrintImageInSandbox(
	source: Source,
	externalId: string | undefined,
	dependencies = {
		configuration: sandboxDiagnosticConfiguration,
		issue: issueTenantPrintSourceCapability,
		fetch,
	},
): Promise<SandboxReport> {
	const report: SandboxReport = {
		version: 1,
		environment: "sandbox",
		order: { outcome: "not_submitted" },
	};
	try {
		if (externalId !== undefined && !sandboxDiagnosticId.test(externalId)) return report;
		const configuration = dependencies.configuration();
		if (configuration.baseUrl !== sandboxOrigin) return report;
		let capabilityUrl: string | undefined;
		report.image = await diagnosePreparedPrintImage(
			source,
			{
				configuration: () => configuration,
				fetch: dependencies.fetch,
				issue: async (descriptor, tenant) => {
					const capability = await dependencies.issue(descriptor, tenant);
					capabilityUrl = capability.url;
					return capability;
				},
			},
			"sandbox",
		);
		const provider = report.image.provider;
		// Sandbox accepts the observed axis normalization without relabeling the
		// conservative image report as passed. Wrong/missing dimensions still stop.
		if (
			!externalId ||
			!capabilityUrl ||
			provider?.status !== 200 ||
			!provider.urlMatches ||
			!["exact", "transposed"].includes(provider.dimensionComparison ?? "")
		)
			return report;
		const payload: LumaPrintsOrder = {
			externalId,
			storeId: configuration.storeId,
			shippingMethod: "default",
			productionTime: "regular",
			recipient: {
				firstName: "Sandbox",
				lastName: "Test",
				addressLine1: "955 E Ball Rd",
				addressLine2: "",
				city: "Anaheim",
				state: "CA",
				zipCode: "92805",
				country: "US",
				phone: "2025550100",
			},
			orderItems: [
				{
					externalItemId: `${externalId}-item-1`,
					subcategoryId: source.product.subcategoryId,
					quantity: 1,
					width: source.printWidth,
					height: source.printHeight,
					file: { imageUrl: capabilityUrl },
					orderItemOptions: source.product.orderItemOptions,
				},
			],
		};
		const body = JSON.stringify(payload);
		report.order.imageUrlSha256 = createHash("sha256").update(capabilityUrl).digest("hex");
		// Once POST starts, transport errors/malformed successes are uncertain.
		// There is deliberately no automatic retry or claim of provider idempotency.
		report.order.outcome = "unknown";
		const response = await dependencies.fetch(`${sandboxOrigin}/api/v1/orders`, {
			method: "POST",
			redirect: "error",
			signal: AbortSignal.timeout(25_000),
			headers: {
				"Content-Type": "application/json",
				Authorization: `Basic ${Buffer.from(`${configuration.apiKey}:${configuration.apiSecret}`).toString("base64")}`,
			},
			body,
		});
		report.order.status = response.status;
		if (response.status === 400 || response.status === 406) report.order.outcome = "rejected";
		if (
			response.status !== 201 ||
			!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")
		) {
			void response.body?.cancel().catch(() => undefined);
			return report;
		}
		const receipt: unknown = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(
				await readPrintDiagnosticBytes(response.body, 32_768),
			),
		);
		if (
			!receipt ||
			typeof receipt !== "object" ||
			Array.isArray(receipt) ||
			!("orderNumber" in receipt)
		)
			return report;
		const orderNumber = normalizeLumaPrintsProviderNumber(receipt.orderNumber);
		if (orderNumber) {
			report.order.orderNumber = orderNumber;
			report.order.outcome = "queued";
		}
	} catch {
		// Never echo capability URLs, provider text, or credentials into telemetry.
	}
	return report;
}
