/**
 * LumaPrints API Client
 * 
 * Handles communication with LumaPrints print-on-demand API.
 * 
 * Base URL: https://us.api.lumaprints.com (production)
 * Auth: Basic HTTP with API Key as username, API Secret as password
 * 
 * Docs: https://api-docs.lumaprints.com
 */

import { LUMAPRINTS_API_KEY, LUMAPRINTS_API_SECRET, LUMAPRINTS_STORE_ID } from '$env/dynamic/private';

/**
 * Create Basic Auth header for LumaPrints API
 */
function getAuthHeader(): string {
	const credentials = Buffer.from(`${LUMAPRINTS_API_KEY}:${LUMAPRINTS_API_SECRET}`).toString('base64');
	return `Basic ${credentials}`;
}

/**
 * Make authenticated request to LumaPrints API
 */
async function lumaprintsRequest<T>(
	endpoint: string,
	options: RequestInit = {}
): Promise<T> {
	const baseUrl = 'https://us.api.lumaprints.com';
	const response = await fetch(`${baseUrl}${endpoint}`, {
		...options,
		headers: {
			'Authorization': getAuthHeader(),
			'Content-Type': 'application/json',
			...options.headers,
		},
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`LumaPrints API error (${response.status}): ${error}`);
	}

	return response.json();
}

// ─── Types ────────────────────────────────────────────────────────────────

export interface LumaPrintsStore {
	storeId: number;
	storeName: string;
}

export interface LumaPrintsCategory {
	id: number;
	name: string;
}

export interface LumaPrintsSubcategory {
	subcategoryId: number;
	name: string;
	minimumWidth: number;
	maximumWidth: number;
	minimumHeight: number;
	maximumHeight: number;
	requiredDPI: number;
}

export interface LumaPrintsOption {
	optionGroup: string;
	optionGroupItems: {
		optionId: number;
		optionName: string;
	}[];
}

export interface ProductPricingRequest {
	subcategoryId: number;
	size: {
		width: number;
		height: number;
	};
	options?: number[];
}

export interface ProductPricingResponse {
	success: boolean;
	subcategoryId: number;
	size: { width: number; height: number };
	price: number;
	options?: {
		optionId: number;
		optionGroupName: string;
		optionName: string;
		price: number;
	}[];
	error?: string;
	statusCode?: number;
}

export interface Recipient {
	firstName: string;
	lastName: string;
	addressLine1: string;
	addressLine2?: string;
	city: string;
	state: string;
	zipCode: string;
	country: string;
	phone: string;
	company?: string;
}

export interface OrderItem {
	externalItemId: string;
	subcategoryId: number;
	quantity: number;
	width: number;
	height: number;
	file: {
		imageUrl: string;
		saveImage?: boolean;
	};
	orderItemOptions: number[];
	solidColorHexCode?: string;
}

export interface CreateOrderRequest {
	externalId: string;
	storeId: number;
	shippingMethod?: 'default' | 'pickup' | 'ground' | 'ground_economy' | '2_day' | 'overnight' | 'usps_ground_advantage' | 'usps_priority_mail' | 'usps_first_class_mail_international' | 'usus_priority_mail_international' | 'usps_priority_mail_express_international' | 'freight';
	productionTime?: 'regular' | 'nextday' | 'sameday';
	specialInstructions?: string;
	printouts?: string[];
	recipient: Recipient;
	orderItems: OrderItem[];
}

export interface CreateOrderResponse {
	message: string;
	orderNumber: string;
}

export interface LumaPrintsOrder {
	orderNumber: string;
	externalId: string;
	storeId: number;
	orderDate: string;
	shippingMethod: string;
	productionTime: string;
	discountTotal: number;
	shippingTotal: number;
	taxTotal: number;
	subTotal: number;
	orderTotal: number;
	orderStatus: string;
	recipient: Recipient;
	orderItems: {
		subcategoryId: number;
		width: number;
		height: number;
		file: { imageUrl: string };
		itemCostTotal: number;
		orderItemOptions: { optionId: number; optionName: string }[];
	}[];
}

// ─── API Functions ────────────────────────────────────────────────────────

/**
 * Get all stores available for the account
 */
export async function getStores(): Promise<LumaPrintsStore[]> {
	return lumaprintsRequest<LumaPrintsStore[]>('/api/v1/stores');
}

/**
 * Get all product categories
 */
export async function getCategories(): Promise<LumaPrintsCategory[]> {
	return lumaprintsRequest<LumaPrintsCategory[]>('/api/v1/products/categories');
}

/**
 * Get subcategories for a category
 */
export async function getSubcategories(categoryId: number): Promise<LumaPrintsSubcategory[]> {
	return lumaprintsRequest<LumaPrintsSubcategory[]>(`/api/v1/products/categories/${categoryId}/subcategories`);
}

/**
 * Get options for a subcategory (e.g., bleed size)
 */
export async function getOptions(subcategoryId: number): Promise<LumaPrintsOption[]> {
	return lumaprintsRequest<LumaPrintsOption[]>(`/api/v1/products/subcategories/${subcategoryId}/options`);
}

/**
 * Get pricing for one or more products
 */
export async function getProductPricing(products: ProductPricingRequest[]): Promise<ProductPricingResponse[]> {
	return lumaprintsRequest<ProductPricingResponse[]>('/api/v1/pricing/products', {
		method: 'POST',
		body: JSON.stringify(products),
	});
}

/**
 * Submit an order to LumaPrints for fulfillment
 */
export async function createOrder(order: CreateOrderRequest): Promise<CreateOrderResponse> {
	return lumaprintsRequest<CreateOrderResponse>('/api/v1/orders', {
		method: 'POST',
		body: JSON.stringify(order),
	});
}

/**
 * Get an order by LumaPrints order number
 */
export async function getOrder(orderNumber: string): Promise<LumaPrintsOrder> {
	return lumaprintsRequest<LumaPrintsOrder>(`/api/v1/orders/${orderNumber}`);
}

/**
 * Validate that an image meets DPI requirements for a subcategory
 * Returns success/failure info
 */
export async function checkImage(imageUrl: string): Promise<{ valid: boolean; message?: string }> {
	try {
		const result = await lumaprintsRequest<any>('/api/v1/images/check', {
			method: 'POST',
			body: JSON.stringify({ imageUrl }),
		});
		return { valid: true, message: result.message };
	} catch (error: any) {
		return { valid: false, message: error.message };
	}
}

/**
 * Get store ID from environment
 */
export function getStoreId(): number {
	return parseInt(String(LUMAPRINTS_STORE_ID), 10);
}
