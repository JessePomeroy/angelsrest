// Shared types for the print shop + LumaPrints fulfillment integration.
// Paper catalog, sizes, order payload shapes, and recipient/order-item
// domain types used by the LumaPrints API client and the Stripe webhook.

/** Paper types currently offered by angelsrest (Fine Art Paper, category 103) */
export type PaperType = "Archival Matte" | "Glossy";

/** LumaPrints subcategory IDs for each paper type */
export const PAPER_SUBCATEGORY_IDS: Record<PaperType, number> = {
	"Archival Matte": 103001,
	Glossy: 103007,
};

/** Available print dimensions (inches) — angelsrest's catalog */
export interface PrintDimensions {
	width: number;
	height: number;
	label: string; // e.g., "8×12"
}

export const AVAILABLE_SIZES: PrintDimensions[] = [
	{ width: 4, height: 6, label: "4×6" },
	{ width: 6, height: 9, label: "6×9" },
	{ width: 8, height: 12, label: "8×12" },
	{ width: 12, height: 18, label: "12×18" },
	{ width: 16, height: 24, label: "16×24" },
];

/** A paper option exposed in the shop UI */
export interface PaperOption {
	name: PaperType;
	subcategoryId: number;
	description: string;
}

export const PAPER_OPTIONS: PaperOption[] = [
	{
		name: "Archival Matte",
		subcategoryId: 103001,
		description: "Museum-quality archival matte — rich tones, no glare",
	},
	{
		name: "Glossy",
		subcategoryId: 103007,
		description: "Vibrant glossy finish — vivid colors, high contrast",
	},
];

/** Order recipient — what we pass to LumaPrints */
export interface Recipient {
	firstName: string;
	lastName: string;
	address1: string;
	address2?: string;
	city: string;
	state: string;
	zip: string;
	country: string;
	phone?: string;
}

/** A single item in a LumaPrints order submission */
export interface OrderItem {
	imageUrl: string;
	paperSubcategoryId: number;
	width: number;
	height: number;
	quantity: number;
	/** Border width in inches. When set, the webhook runs Sharp to composite a white border. */
	borderWidth?: number;
	/** LumaPrints frame subcategory ID (105001-105007). When set, the order is submitted as framed. */
	frameSubcategoryId?: number;
	/** LumaPrints canvas subcategory ID (101001-101005). When set, submitted as canvas with solid black wrap. */
	canvasSubcategoryId?: number;
}

/** LumaPrints API order payload */
export interface LumaPrintsOrder {
	externalId: string;
	storeId: number;
	shippingMethod: string;
	recipient: {
		firstName: string;
		lastName: string;
		addressLine1: string;
		addressLine2: string;
		city: string;
		state: string;
		zipCode: string;
		country: string;
		phone: string;
	};
	orderItems: {
		externalItemId: string;
		subcategoryId: number;
		quantity: number;
		width: number;
		height: number;
		file: { imageUrl: string };
		orderItemOptions: number[];
	}[];
}

/** LumaPrints API order response */
export interface LumaPrintsOrderResponse {
	orderNumber: string;
	status?: string;
}

/** LumaPrints shipment info */
export interface LumaPrintsShipment {
	orderNumber: string;
	trackingNumber: string;
	trackingUrl?: string;
	carrier: string;
}
