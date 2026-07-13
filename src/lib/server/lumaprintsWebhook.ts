import { createHash, timingSafeEqual } from "node:crypto";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_SHIPMENTS = 50;

export interface LumaPrintsShipment {
	orderNumber: string;
	trackingNumber?: string;
	carrier?: string;
}

interface ShipmentClaim {
	claimed: boolean;
	order: {
		siteUrl: string;
		orderNumber: string;
		customerEmail: string;
	};
}

export type ShipmentEmailDelivery =
	| { status: "sent" }
	| { status: "failed"; error: string }
	| { status: "skipped"; error?: string };

export interface LumaPrintsShipmentDependencies {
	claim(input: LumaPrintsShipment): Promise<ShipmentClaim | null>;
	record(input: {
		lumaprintsOrderNumber: string;
		status: ShipmentEmailDelivery["status"];
		error?: string;
	}): Promise<unknown>;
	send(input: {
		siteUrl: string;
		customerEmail: string;
		orderNumber: string;
		lumaprintsOrderNumber: string;
		trackingNumber?: string;
		carrier?: string;
	}): Promise<void>;
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
		throw new Error("LumaPrints webhook body is too large");
	}

	let value: unknown;
	try {
		value = JSON.parse(rawBody);
	} catch {
		throw new Error("Invalid LumaPrints webhook JSON");
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Invalid LumaPrints webhook payload");
	}

	const payload = value as Record<string, unknown>;
	if (payload.event !== undefined && payload.event !== "shipping") {
		throw new Error("Unsupported LumaPrints webhook event");
	}
	const orderNumber = boundedString(payload.orderNumber, "orderNumber", 100, true);
	if (!orderNumber) throw new Error("Invalid LumaPrints orderNumber");
	if (!Array.isArray(payload.shipments) || payload.shipments.length === 0) {
		throw new Error("LumaPrints shipping payload has no shipments");
	}
	if (payload.shipments.length > MAX_SHIPMENTS) {
		throw new Error("LumaPrints shipping payload has too many shipments");
	}

	const latest = payload.shipments.at(-1);
	if (!latest || typeof latest !== "object" || Array.isArray(latest)) {
		throw new Error("Invalid LumaPrints shipment");
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
	const claim = await dependencies.claim(shipment);
	if (!claim) return { status: "unknown_order" as const };
	if (!claim.claimed) return { status: "already_processed" as const };

	let delivery: ShipmentEmailDelivery;
	if (!claim.order.customerEmail) {
		delivery = { status: "skipped", error: "Order has no customer email" };
	} else {
		try {
			await dependencies.send({
				siteUrl: claim.order.siteUrl,
				customerEmail: claim.order.customerEmail,
				orderNumber: claim.order.orderNumber,
				lumaprintsOrderNumber: shipment.orderNumber,
				trackingNumber: shipment.trackingNumber,
				carrier: shipment.carrier,
			});
			delivery = { status: "sent" };
		} catch (error) {
			delivery = { status: "failed", error: errorMessage(error) };
		}
	}

	await dependencies.record({
		lumaprintsOrderNumber: shipment.orderNumber,
		status: delivery.status,
		error: "error" in delivery ? delivery.error : undefined,
	});
	return { status: "processed" as const, delivery };
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
	if (required) throw new Error(`Invalid LumaPrints ${field}`);
	if (value !== undefined && value !== null && value !== "") {
		throw new Error(`Invalid LumaPrints ${field}`);
	}
	return undefined;
}

function errorMessage(error: unknown) {
	if (error instanceof Error && error.message) return error.message;
	return "Shipment email delivery failed";
}
