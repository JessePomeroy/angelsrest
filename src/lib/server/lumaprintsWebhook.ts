import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { Id } from "$convex/dataModel";
import { normalizeLumaPrintsProviderNumber } from "$lib/server/lumaprintsProviderNumber";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_SHIPMENTS = 50;

export interface LumaPrintsShipment {
	orderNumber: string;
	trackingNumber?: string;
	carrier?: string;
}

type ShipmentClaim =
	| {
			kind: "claimed";
			leaseExpiresAt: number;
			order: {
				_id: Id<"orders">;
				siteUrl: string;
				orderNumber: string;
				customerEmail: string;
			};
	  }
	| { kind: "busy"; leaseExpiresAt: number }
	| { kind: "completed" };

export type ShipmentEmailDeliveryFailureCode =
	| "missing_customer_email"
	| "notification_profile_unavailable"
	| "email_delivery_failed"
	| "unexpected_send_failure";

export class ShipmentEmailDeliveryError extends Error {
	constructor(readonly code: ShipmentEmailDeliveryFailureCode) {
		super("Shipment email delivery failed");
		this.name = "ShipmentEmailDeliveryError";
	}
}

export interface LumaPrintsShipmentDependencies {
	claim(input: LumaPrintsShipment & { claimToken: string }): Promise<ShipmentClaim | null>;
	complete(input: {
		orderId: Id<"orders">;
		lumaprintsOrderNumber: string;
		claimToken: string;
		deliveryStatus: "sent" | "skipped";
	}): Promise<boolean>;
	release(input: {
		orderId: Id<"orders">;
		lumaprintsOrderNumber: string;
		claimToken: string;
		failureCode: ShipmentEmailDeliveryFailureCode;
	}): Promise<boolean>;
	send(input: {
		siteUrl: string;
		customerEmail: string;
		orderNumber: string;
		lumaprintsOrderNumber: string;
		trackingNumber?: string;
		carrier?: string;
	}): Promise<void>;
}

export class LumaPrintsWebhookPayloadError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 413 = 400,
	) {
		super(message);
		this.name = "LumaPrintsWebhookPayloadError";
	}
}

function payloadError(message: string, status: 400 | 413 = 400) {
	return new LumaPrintsWebhookPayloadError(message, status);
}

function cancelBody(reader: ReadableStreamDefaultReader<Uint8Array>) {
	try {
		void reader.cancel().catch(() => undefined);
	} catch {
		// Cancellation is best-effort cleanup. Keep the selected boundary failure.
	}
}

/** Read and parse a webhook body without allocating an unbounded aggregate string. */
export async function readLumaPrintsShippingPayload(request: Request) {
	const declaredLength = request.headers.get("content-length");
	if (declaredLength !== null) {
		if (!/^\d+$/.test(declaredLength)) {
			throw payloadError("Invalid LumaPrints webhook content length");
		}
		if (BigInt(declaredLength) > BigInt(MAX_BODY_BYTES)) {
			throw payloadError("LumaPrints webhook body is too large", 413);
		}
	}

	const reader = request.body?.getReader();
	if (!reader) return parseLumaPrintsShippingPayload("");
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_BODY_BYTES) {
				cancelBody(reader);
				throw payloadError("LumaPrints webhook body is too large", 413);
			}
			chunks.push(value);
		}
	} catch (error) {
		if (error instanceof LumaPrintsWebhookPayloadError) throw error;
		throw payloadError("Unable to read LumaPrints webhook body");
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	let rawBody: string;
	try {
		rawBody = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw payloadError("Invalid LumaPrints webhook UTF-8");
	}
	return parseLumaPrintsShippingPayload(rawBody);
}

export function verifyLumaPrintsBasicAuthorization(
	header: string | null,
	username: string,
	password: string,
	previousPassword?: string,
) {
	if (!username || !password || !header?.startsWith("Basic ")) return false;
	let decoded: string;
	try {
		decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
	} catch {
		return false;
	}
	const separator = decoded.indexOf(":");
	if (separator < 0) return false;
	const providedUsername = decoded.slice(0, separator);
	const providedPassword = decoded.slice(separator + 1);
	const usernameMatches = secureEqual(providedUsername, username);
	const currentPasswordMatches = secureEqual(providedPassword, password);
	const previousPasswordMatches = previousPassword
		? secureEqual(providedPassword, previousPassword)
		: false;
	return usernameMatches && (currentPasswordMatches || previousPasswordMatches);
}

export function parseLumaPrintsShippingPayload(rawBody: string): LumaPrintsShipment {
	if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
		throw payloadError("LumaPrints webhook body is too large", 413);
	}

	let value: unknown;
	try {
		value = JSON.parse(rawBody);
	} catch {
		throw payloadError("Invalid LumaPrints webhook JSON");
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw payloadError("Invalid LumaPrints webhook payload");
	}

	const payload = value as Record<string, unknown>;
	if (payload.event !== undefined && payload.event !== "shipping") {
		throw payloadError("Unsupported LumaPrints webhook event");
	}
	const orderNumber = normalizeLumaPrintsProviderNumber(payload.orderNumber);
	if (orderNumber === null) throw payloadError("Invalid LumaPrints orderNumber");
	if (!Array.isArray(payload.shipments) || payload.shipments.length === 0) {
		throw payloadError("LumaPrints shipping payload has no shipments");
	}
	if (payload.shipments.length > MAX_SHIPMENTS) {
		throw payloadError("LumaPrints shipping payload has too many shipments");
	}

	const latest = payload.shipments.at(-1);
	if (!latest || typeof latest !== "object" || Array.isArray(latest)) {
		throw payloadError("Invalid LumaPrints shipment");
	}
	const shipment = latest as Record<string, unknown>;
	return {
		orderNumber,
		trackingNumber: boundedString(shipment.trackingNumber, "trackingNumber", 255),
		carrier: boundedString(shipment.carrier, "carrier", 100),
	};
}

export async function processLumaPrintsShipment(
	shipment: LumaPrintsShipment,
	dependencies: LumaPrintsShipmentDependencies,
) {
	const claimToken = randomUUID();
	const claim = await dependencies.claim({ ...shipment, claimToken });
	if (!claim) return { status: "unknown_order" as const };
	if (claim.kind === "completed") return { status: "already_processed" as const };
	if (claim.kind === "busy") {
		return {
			status: "busy" as const,
			retryAfterMs: Math.max(0, claim.leaseExpiresAt - Date.now()),
		};
	}

	const checkpoint = {
		orderId: claim.order._id,
		lumaprintsOrderNumber: shipment.orderNumber,
		claimToken,
	};
	if (!claim.order.customerEmail) {
		const completed = await dependencies.complete({ ...checkpoint, deliveryStatus: "skipped" });
		if (!completed) throw new Error("Shipment email completion claim was lost");
		return { status: "processed" as const, delivery: { status: "skipped" as const } };
	}

	try {
		await dependencies.send({
			siteUrl: claim.order.siteUrl,
			customerEmail: claim.order.customerEmail,
			orderNumber: claim.order.orderNumber,
			lumaprintsOrderNumber: shipment.orderNumber,
			trackingNumber: shipment.trackingNumber,
			carrier: shipment.carrier,
		});
	} catch (error) {
		const failureCode =
			error instanceof ShipmentEmailDeliveryError ? error.code : "unexpected_send_failure";
		const released = await dependencies.release({ ...checkpoint, failureCode });
		if (!released) {
			throw new Error("Shipment email release claim was lost");
		}
		return { status: "retryable_failure" as const, failureCode };
	}

	const completed = await dependencies.complete({ ...checkpoint, deliveryStatus: "sent" });
	if (!completed) throw new Error("Shipment email completion claim was lost");
	return { status: "processed" as const, delivery: { status: "sent" as const } };
}

function secureEqual(actual: string, expected: string) {
	const actualDigest = createHash("sha256").update(actual).digest();
	const expectedDigest = createHash("sha256").update(expected).digest();
	return timingSafeEqual(actualDigest, expectedDigest);
}

function boundedString(
	value: unknown,
	field: string,
	maxLength: number,
	required = false,
): string | undefined {
	if ((typeof value === "number" && Number.isFinite(value)) || typeof value === "string") {
		const normalized = String(value).trim();
		if (normalized && normalized.length <= maxLength) return normalized;
	}
	if (required) throw payloadError(`Invalid LumaPrints ${field}`);
	if (value !== undefined && value !== null && value !== "") {
		throw payloadError(`Invalid LumaPrints ${field}`);
	}
	return undefined;
}
