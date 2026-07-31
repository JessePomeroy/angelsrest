import { getPaperBySlug, getSizeBySlug, getWholesaleCost } from "@jessepomeroy/print-catalog";

const MEDIA_ROOT = "https://media.angelsrest.online/sites/angelsrest.online/web";
const KIND_COUNTS = {
	print: 11,
	print_set: 2,
	postcard: 0,
	tapestry: 19,
	digital_download: 1,
	merchandise: 0,
} as const;
const CATEGORIES = {
	postcard: "postcards",
	tapestry: "tapestries",
	digital_download: "digital",
	merchandise: "merchandise",
} as const;
const ROLES = new Set(["primary", "cover", "gallery", "set_member", "social_share"]);
const STABLE = /^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPTION = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PRESETS = {
	thumb: { filename: "thumb", width: 320 },
	card: { filename: "card", width: 768 },
	display1280: { filename: "display-1280", width: 1280 },
	display2048: { filename: "display-2048", width: 2048 },
	display2560: { filename: "display-2560", width: 2560 },
} as const;

type Kind = keyof typeof KIND_COUNTS;
type Preset = keyof typeof PRESETS;

const KINDS = Object.keys(KIND_COUNTS) as Kind[];

export class ConvexShopProjectionError extends Error {}

function fail(): never {
	throw new ConvexShopProjectionError("Malformed public catalog projection");
}

function object(value: unknown, keys: readonly string[]) {
	if (!value || typeof value !== "object" || Array.isArray(value)) fail();
	if (Object.getPrototypeOf(value) !== Object.prototype) fail();
	const ownKeys = Reflect.ownKeys(value);
	if (ownKeys.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail();
	return value as Record<string, unknown>;
}

function text(value: unknown, maximum: number, pattern?: RegExp) {
	if (typeof value !== "string") fail();
	if (!value || value !== value.trim() || value.length > maximum) fail();
	if (pattern && !pattern.test(value)) fail();
	return value;
}

function optionalText(value: unknown, maximum: number) {
	return value === null ? undefined : text(value, maximum);
}

function integer(value: unknown, minimum = 0, maximum = 100_000_000) {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum)
		fail();
	return value as number;
}

function asset(value: unknown) {
	const item = object(value, ["assetId", "source", "derivatives"]);
	const assetId = text(item.assetId, 36, UUID_V4);
	const source = object(item.source, ["width", "height"]);
	const sourceWidth = integer(source.width, 1, 100_000);
	const sourceHeight = integer(source.height, 1, 100_000);
	const derivatives = object(item.derivatives, Object.keys(PRESETS));
	for (const preset of Object.keys(PRESETS) as Preset[]) {
		const derivative = object(derivatives[preset], ["contentType", "width", "height"]);
		if (derivative.contentType !== "image/webp") fail();
		const expectedWidth = Math.min(sourceWidth, PRESETS[preset].width);
		const expectedHeight = Math.max(1, Math.round(sourceHeight * (expectedWidth / sourceWidth)));
		if (derivative.width !== expectedWidth || derivative.height !== expectedHeight) fail();
	}
	return { url: (preset: Preset) => `${MEDIA_ROOT}/${assetId}/${PRESETS[preset].filename}.webp` };
}

function variants(value: unknown, isPrint: boolean, available: boolean) {
	if (!Array.isArray(value) || value.length > 100 || (available && value.length === 0)) fail();
	const keys = new Set<string>();
	const selectors = new Set<string>();
	let previousOrder = -1;
	const result = value.map((raw) => {
		const item = object(raw, ["key", "order", "materialOption", "sizeOption", "retailPriceCents"]);
		const key = text(item.key, 120, STABLE);
		const order = integer(item.order, 0, 99);
		if (keys.has(key) || order <= previousOrder) fail();
		keys.add(key);
		previousOrder = order;
		let material = null;
		let size = null;
		if (isPrint) {
			const materialValue = object(item.materialOption, ["label", "slug"]);
			const sizeValue = object(item.sizeOption, ["heightInches", "widthInches", "label", "slug"]);
			const materialSlug = text(materialValue.slug, 120, OPTION);
			const sizeSlug = text(sizeValue.slug, 120, OPTION);
			const knownMaterial = getPaperBySlug(materialSlug);
			const knownSize = getSizeBySlug(sizeSlug);
			if (
				!knownMaterial ||
				!knownSize ||
				getWholesaleCost(materialSlug, sizeSlug) === null ||
				materialValue.label !== knownMaterial.name ||
				sizeValue.label !== knownSize.label ||
				sizeValue.widthInches !== knownSize.width ||
				sizeValue.heightInches !== knownSize.height
			)
				fail();
			material = materialSlug;
			size = sizeSlug;
			const selector = `${materialSlug}:${sizeSlug}`;
			if (selectors.has(selector)) fail();
			selectors.add(selector);
		} else if (item.materialOption !== null || item.sizeOption !== null) fail();
		return { order, material, size, retailPriceCents: integer(item.retailPriceCents, 1) };
	});
	if (!isPrint && result.length > 1) fail();
	return result;
}

function media(value: unknown, kind: Kind) {
	if (!Array.isArray(value) || value.length === 0 || value.length > 50) fail();
	const keys = new Set<string>();
	const roleOrders = new Map<string, number>();
	const result = value.map((raw) => {
		const item = object(raw, ["key", "role", "order", "altText", "asset"]);
		const key = text(item.key, 120, STABLE);
		const role = text(item.role, 40);
		const order = integer(item.order, 0, 49);
		if (keys.has(key) || !ROLES.has(role) || order !== (roleOrders.get(role) ?? 0)) fail();
		keys.add(key);
		roleOrders.set(role, order + 1);
		const alt = item.altText === null ? null : text(item.altText, 1_000);
		if (role !== "social_share" && alt === null) fail();
		return { role, alt, ...asset(item.asset) };
	});
	const required = kind === "print" ? "primary" : kind === "print_set" ? "cover" : "gallery";
	if (!result.some((item) => item.role === required)) fail();
	if (kind === "print_set" && !result.some((item) => item.role === "set_member")) fail();
	return result;
}

function normalize(value: unknown) {
	const baseKeys = [
		"schemaVersion",
		"productId",
		"revisionId",
		"productKind",
		"title",
		"slug",
		"description",
		"seoDescription",
		"currency",
		"saleAvailability",
		"variants",
		"shopPlacement",
		"media",
	];
	if (!value || typeof value !== "object" || Array.isArray(value)) fail();
	const candidate = value as Record<string, unknown>;
	const kind = KINDS.find((entry) => entry === candidate.productKind);
	if (!kind) fail();
	const isPrint = kind === "print" || kind === "print_set";
	const item = object(value, isPrint ? [...baseKeys, "printOptions"] : baseKeys);
	if (item.schemaVersion !== 2 || item.currency !== "usd") fail();
	text(item.productId, 120, STABLE);
	text(item.revisionId, 120, STABLE);
	const availability = item.saleAvailability;
	if (availability !== "available" && availability !== "unavailable") fail();
	const placement = object(item.shopPlacement, ["featured", "orderRank"]);
	if (typeof placement.featured !== "boolean") fail();
	const options = isPrint
		? object(item.printOptions, [
				"borderOptionsEnabled",
				"frameOptionsEnabled",
				"framePriceMultiplierBasisPoints",
			])
		: null;
	if (options && typeof options.borderOptionsEnabled !== "boolean") fail();
	if (options && typeof options.frameOptionsEnabled !== "boolean") fail();
	return {
		kind,
		title: text(item.title, 160),
		slug: text(item.slug, 96, SLUG),
		description: optionalText(item.description, 5_000),
		seoDescription: optionalText(item.seoDescription, 320),
		inStock: availability === "available",
		featured: placement.featured,
		orderRank: placement.orderRank === null ? null : text(placement.orderRank, 120),
		variants: variants(item.variants, isPrint, availability === "available"),
		media: media(item.media, kind),
		...(options
			? {
					printOptions: {
						bordersEnabled: options.borderOptionsEnabled as boolean,
						framedEnabled: options.frameOptionsEnabled as boolean,
						frameMarkupMultiplier:
							integer(options.framePriceMultiplierBasisPoints, 0, 1_000_000) / 10_000,
					},
				}
			: {}),
	};
}

type Product = ReturnType<typeof normalize>;
type Media = Product["media"][number];

function role(product: Product, name: string) {
	return product.media.filter((item) => item.role === name);
}

function price(product: Product) {
	return product.variants.length
		? Math.min(...product.variants.map((variant) => variant.retailPriceCents)) / 100
		: undefined;
}

function category(kind: Kind) {
	if (kind === "print") return "prints";
	if (kind === "print_set") fail();
	return CATEGORIES[kind];
}

function productImage(item: Media) {
	return {
		thumbnail: item.url("thumb"),
		full: item.url("display1280"),
		original: item.url("display2560"),
		alt: item.alt ?? "",
	};
}

function setImage(item: Media) {
	const { thumbnail: thumb, ...rest } = productImage(item);
	return { thumb, ...rest };
}

function completeProducts(value: unknown) {
	if (!Array.isArray(value) || value.length !== 33) fail();
	const products = value.map(normalize);
	if (new Set(products.map(({ slug }) => slug)).size !== products.length) fail();
	for (const kind of KINDS)
		if (products.filter((product) => product.kind === kind).length !== KIND_COUNTS[kind]) fail();
	return products;
}

function compareText(left: string | null | undefined, right: string | null | undefined) {
	const a = left ?? "";
	const b = right ?? "";
	return a < b ? -1 : a > b ? 1 : 0;
}

function compareOrderRank(left: string | null | undefined, right: string | null | undefined) {
	if (left == null && right == null) return 0;
	if (left == null) return 1;
	if (right == null) return -1;
	return compareText(left, right);
}

function orderIndexBucket(products: Product[]) {
	const prints = products
		.filter((product) => product.kind === "print")
		.sort((left, right) => compareText(left.title, right.title));
	const general = products
		.filter((product) => product.kind !== "print" && product.kind !== "print_set")
		.sort((left, right) => {
			const byRank = compareOrderRank(left.orderRank, right.orderRank);
			return byRank || compareText(left.title, right.title);
		});
	return [...prints, ...general];
}

export function adaptConvexIndex(value: unknown) {
	const available = completeProducts(value).filter((product) => product.inStock);
	const products = [
		...orderIndexBucket(available.filter((product) => product.featured)),
		...orderIndexBucket(available.filter((product) => !product.featured)),
	];
	return {
		products: products.map((product) => {
			const display = role(product, product.kind === "print" ? "primary" : "gallery")[0];
			const amount = price(product);
			if (!display || amount === undefined) fail();
			return {
				title: product.title,
				slug: product.slug,
				preview: display.url("card"),
				price: amount,
				...(product.kind === "print" ? { startingPrice: amount } : {}),
				category: category(product.kind),
				featured: product.featured,
				inStock: true,
			};
		}),
		printSets: available
			.filter((product) => product.kind === "print_set")
			.map((product) => {
				const cover = role(product, "cover")[0];
				const amount = price(product);
				if (!cover || amount === undefined) fail();
				const members = role(product, "set_member");
				return {
					title: product.title,
					slug: product.slug,
					description: product.description,
					previewImage: cover.url("card"),
					preview1: members[0]?.url("thumb"),
					preview2: members[1]?.url("thumb"),
					startingPrice: amount,
					price: amount,
				};
			}),
	};
}

function selectProduct(value: unknown, productSlug?: string) {
	if (productSlug !== undefined) {
		return completeProducts(value).find((product) => product.slug === productSlug) ?? null;
	}
	return value === null ? null : normalize(value);
}

export function adaptConvexProduct(value: unknown, productSlug?: string) {
	const product = selectProduct(value, productSlug);
	if (!product) return null;
	if (product.kind === "print_set") return null;
	if (product.kind === "print") {
		const primary = role(product, "primary")[0];
		if (!primary || !product.printOptions) fail();
		return {
			productType: "v2" as const,
			product: {
				title: product.title,
				slug: product.slug,
				description: product.description,
				variants: product.variants.map((variant) => ({
					paper: variant.material as string,
					size: variant.size as string,
					retailPrice: variant.retailPriceCents / 100,
				})),
				...product.printOptions,
				inStock: product.inStock,
				featured: product.featured,
				images: [productImage(primary)],
				...({} as { price?: number; category?: string }),
			},
		};
	}
	const gallery = role(product, "gallery");
	const social = role(product, "social_share")[0];
	return {
		productType: "v1" as const,
		product: {
			title: product.title,
			slug: product.slug,
			description: product.description,
			price: price(product),
			category: category(product.kind),
			featured: product.featured,
			inStock: product.inStock,
			images: gallery.map(productImage),
			availablePapers: [],
			...(product.seoDescription || social
				? {
						seo: {
							description: product.seoDescription,
							...(social ? { ogImageUrl: social.url("display1280") } : {}),
						},
					}
				: {}),
		},
	};
}

export function adaptConvexPrintSet(value: unknown, productSlug?: string) {
	const product = selectProduct(value, productSlug);
	if (!product) return null;
	if (product.kind !== "print_set") return null;
	const cover = role(product, "cover")[0];
	if (!cover || !product.printOptions) fail();
	return {
		printSet: {
			title: product.title,
			slug: product.slug,
			description: product.description,
			previewImage: cover.url("card"),
			variants: product.variants.map((variant) => ({
				paper: variant.material as string,
				size: variant.size as string,
				retailPrice: variant.retailPriceCents / 100,
			})),
			...product.printOptions,
			inStock: product.inStock,
			...({} as { parent?: { title: string; slug: string } }),
		},
		images: role(product, "set_member").map(setImage),
	};
}
