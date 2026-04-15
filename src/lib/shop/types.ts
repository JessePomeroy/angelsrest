// Shared types for the print shop + LumaPrints fulfillment integration.
// Paper catalog, sizes, order payload shapes, and recipient/order-item
// domain types used by the LumaPrints API client and the Stripe webhook.

/** Available print dimensions (inches) */
export interface PrintDimensions {
	width: number;
	height: number;
	label: string; // e.g., "8×12"
}

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
