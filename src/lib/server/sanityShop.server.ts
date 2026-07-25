import type { SanityImageSource } from "@sanity/image-url";
import { error } from "@sveltejs/kit";
import { getSanityClient } from "$lib/sanity/client.server";
import { displayUrl, imageSet, originalUrl, previewUrl, thumbnailUrl } from "$lib/utils/images";

export type SanityShopClient = Pick<ReturnType<typeof getSanityClient>, "fetch">;
type SanityClientSelector = (isPreview: boolean) => SanityShopClient;
type ShopImage = SanityImageSource & { alt?: string };

type PrintVariant = {
	paper?: string;
	size?: string;
	retailPrice?: number;
};

type ProductRow = {
	title: string;
	slug: string;
	previewImage: SanityImageSource;
	category: string;
	featured?: boolean;
	inStock: boolean;
	startingPrice?: number;
	price?: number;
	collection?: { slug: string; title: string };
};

type CollectionRow = {
	title: string;
	slug: string;
	previewImage: ShopImage;
	description?: string;
};

type PrintSetRow = {
	title: string;
	slug: string;
	images?: ShopImage[];
	previewImage: SanityImageSource;
	description?: string;
	startingPrice?: number;
};

type V2ProductRow = {
	title: string;
	description?: string;
	image?: ShopImage;
	variants?: PrintVariant[] | null;
	bordersEnabled?: boolean | null;
	framedEnabled?: boolean | null;
	frameMarkupMultiplier?: number | null;
	inStock?: boolean | null;
	featured?: boolean | null;
};

type AvailablePaper = {
	name: string;
	price?: number;
	subcategoryId?: string;
	width?: number;
	height?: number;
};

type V1ProductRow = {
	title: string;
	description?: string;
	price?: number;
	category?: string;
	featured?: boolean;
	inStock?: boolean;
	images?: ShopImage[] | null;
	availablePapers: AvailablePaper[];
	seo?: { description?: string; ogImageUrl?: string };
};

type V2ProjectedProduct = {
	title: string;
	slug: string;
	description?: string;
	variants: PrintVariant[];
	bordersEnabled: boolean;
	framedEnabled: boolean;
	frameMarkupMultiplier: number;
	inStock: boolean;
	featured: boolean;
	images: Array<{
		thumbnail: string | null;
		full: string | null;
		original: string | null;
		alt: string;
	}>;
	// These V1-only fields remain absent at runtime; declaring them keeps the
	// route's pre-existing shared product access type-safe without adding keys.
	price?: number;
	category?: string;
	availablePapers: AvailablePaper[];
};

type PrintSetDetailRow = {
	title: string;
	description?: string;
	previewImage: SanityImageSource;
	images?: Array<ShopImage | null> | null;
	variants?: PrintVariant[] | null;
	bordersEnabled?: boolean | null;
	framedEnabled?: boolean | null;
	frameMarkupMultiplier?: number | null;
	inStock?: boolean | null;
	parent?: { title: string; slug: string };
};

type CollectionDetailRow = {
	title: string;
	description?: string;
	previewImage: ShopImage;
	parent?: { title: string; slug: string };
};

type CollectionPrintSetRow = {
	title: string;
	slug: string;
	images?: ShopImage[];
	previewImage: SanityImageSource;
	price?: number;
};

type CollectionProductRow = {
	title: string;
	slug: string;
	previewImage: SanityImageSource;
	price?: number;
};

const V2_PRODUCT_QUERY = `
  *[_type == "lumaProductV2" && slug.current == $slug][0]{
    title,
    description,
    image,
    variants[enabled == true]{paper, size, retailPrice},
    bordersEnabled,
    framedEnabled,
    frameMarkupMultiplier,
    inStock,
    featured
  }
`;

const V1_PRODUCT_QUERY = `
  *[_type == "product" && slug.current == $slug][0]{
    title,
    description,
    price,
    category,
    featured,
    inStock,
    images[],
    availablePapers[]{
      name,
      price,
      subcategoryId,
      width,
      height
    },
    seo{
      description,
      "ogImageUrl": ogImage.asset->url
    }
  }
`;

const PRINT_SET_QUERY = `
  *[_type == "lumaPrintSetV2" && slug.current == $slug][0]{
    title,
    description,
    previewImage,
    images,
    variants[enabled == true]{paper, size, retailPrice},
    bordersEnabled,
    framedEnabled,
    frameMarkupMultiplier,
    inStock,
    "parent": parent->{
      title,
      "slug": slug.current
    }
  }
`;

export function createSanityShopAdapter(selectClient: SanityClientSelector = getSanityClient) {
	return {
		async loadIndex(isPreview: boolean) {
			const sanity = selectClient(isPreview);
			const v2Products = await sanity.fetch<ProductRow[]>(`
				*[_type == "lumaProductV2" && inStock == true]
				| order(featured desc, title asc) {
					title,
					"slug": slug.current,
					"previewImage": image,
					"category": "prints",
					featured,
					inStock,
					"startingPrice": variants[enabled == true] | order(retailPrice asc) [0].retailPrice
				}
			`);

			const v2WithImages = v2Products.map((p) => ({
				...p,
				preview: previewUrl(p.previewImage),
				price: p.startingPrice,
			}));

			const v1Products = await sanity.fetch<ProductRow[]>(`
				*[_type == "product" && inStock == true]
				| order(featured desc, orderRank, title asc) {
					title,
					"slug": slug.current,
					"previewImage": images[0],
					price,
					category,
					featured,
					inStock,
					"collection": collection->{
						"slug": slug.current,
						title
					}
				}
			`);

			const v1WithImages = v1Products.map((p) => ({
				...p,
				preview: previewUrl(p.previewImage),
			}));

			const products = [...v2WithImages, ...v1WithImages].sort(
				(a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0),
			);

			const collections = await sanity.fetch<CollectionRow[]>(`
				*[_type == "printCollection" && !defined(parent)]
				| order(orderRank, title asc) {
					title,
					"slug": slug.current,
					previewImage,
					description
				}
			`);

			const collectionsWithImages = collections.map((c) => ({
				...c,
				alt: c.previewImage?.alt || "",
				previewImage: previewUrl(c.previewImage),
			}));

			const v2Sets = await sanity.fetch<PrintSetRow[]>(`
				*[_type == "lumaPrintSetV2" && inStock == true]
				| order(featured desc, title asc) {
					title,
					"slug": slug.current,
					images[0..1],
					previewImage,
					description,
					"startingPrice": variants[enabled == true] | order(retailPrice asc) [0].retailPrice
				}
			`);

			const v2SetsWithImages = v2Sets.map((s) => ({
				...s,
				preview1: s.images?.[0] ? imageSet(s.images[0])?.thumb : undefined,
				preview2: s.images?.[1] ? imageSet(s.images[1])?.thumb : undefined,
				previewImage: previewUrl(s.previewImage),
				price: s.startingPrice,
			}));

			return {
				products,
				collections: collectionsWithImages,
				printSets: v2SetsWithImages,
			};
		},

		async loadProduct(slug: string, isPreview: boolean) {
			const sanity = selectClient(isPreview);
			const v2Product = await sanity.fetch<V2ProductRow | null>(V2_PRODUCT_QUERY, { slug });

			if (v2Product !== null) {
				const image = v2Product.image;
				return {
					productType: "v2" as const,
					product: {
						title: v2Product.title,
						slug,
						description: v2Product.description,
						variants: v2Product.variants || [],
						bordersEnabled: v2Product.bordersEnabled ?? true,
						framedEnabled: v2Product.framedEnabled ?? false,
						frameMarkupMultiplier: v2Product.frameMarkupMultiplier ?? 2,
						inStock: v2Product.inStock ?? true,
						featured: v2Product.featured ?? false,
						images: image
							? [
									{
										thumbnail: thumbnailUrl(image),
										full: displayUrl(image),
										original: originalUrl(image),
										alt: image.alt || v2Product.title,
									},
								]
							: [],
					} as V2ProjectedProduct,
				};
			}

			const v1Product = await sanity.fetch<V1ProductRow | null>(V1_PRODUCT_QUERY, { slug });
			if (!v1Product) throw error(404, "Product not found");

			const optimizedImages = (v1Product.images || []).map((image) => ({
				thumbnail: thumbnailUrl(image),
				full: displayUrl(image),
				original: originalUrl(image),
				alt: image.alt || v1Product.title,
			}));

			return {
				productType: "v1" as const,
				product: {
					...v1Product,
					slug,
					images: optimizedImages,
				},
			};
		},

		async loadPrintSet(slug: string, isPreview: boolean) {
			const sanity = selectClient(isPreview);
			const printSet = await sanity.fetch<PrintSetDetailRow | null>(PRINT_SET_QUERY, { slug });
			if (!printSet) throw error(404, "Print set not found");

			const preview = previewUrl(printSet.previewImage);
			const images = (printSet.images || [])
				.map((img) => imageSet(img as ShopImage))
				.filter((image) => image !== null);

			return {
				printSet: {
					title: printSet.title,
					slug,
					description: printSet.description,
					previewImage: preview,
					variants: printSet.variants || [],
					bordersEnabled: printSet.bordersEnabled ?? true,
					framedEnabled: printSet.framedEnabled ?? false,
					frameMarkupMultiplier: printSet.frameMarkupMultiplier ?? 2,
					inStock: printSet.inStock ?? true,
					parent: printSet.parent,
				},
				images,
			};
		},

		async loadCollection(slug: string, isPreview: boolean) {
			const sanity = selectClient(isPreview);
			const collection = await sanity.fetch<CollectionDetailRow | null>(
				`*[_type == "printCollection" && slug.current == $slug][0]{
					title,
					description,
					previewImage,
					"parent": parent->{
						title,
						"slug": slug.current
					}
				}`,
				{ slug },
			);

			if (!collection) throw error(404, "Collection not found");

			const subCollections = await sanity.fetch<CollectionRow[]>(
				`*[_type == "printCollection" && references(*[_type == "printCollection" && slug.current == $slug]._id)]
				| order(orderRank, title asc) {
					title,
					"slug": slug.current,
					previewImage
				}`,
				{ slug },
			);

			const printSets = await sanity.fetch<CollectionPrintSetRow[]>(
				`*[_type == "lumaPrintSetV2" && references(*[_type == "printCollection" && slug.current == $slug]._id) && inStock == true]
				| order(featured desc, title asc) {
					title,
					"slug": slug.current,
					images[0..1],
					previewImage,
					"price": variants[enabled == true] | order(retailPrice asc) [0].retailPrice
				}`,
				{ slug },
			);

			const products = await sanity.fetch<CollectionProductRow[]>(
				`*[_type == "product" && references(*[_type == "printCollection" && slug.current == $slug]._id) && inStock == true]
				| order(orderRank, title asc) {
					title,
					"slug": slug.current,
					"previewImage": images[0],
					price
				}`,
				{ slug },
			);

			const previewImageUrl = previewUrl(collection.previewImage);
			const subCollectionsWithImages = subCollections.map((sub) => ({
				...sub,
				previewImage: previewUrl(sub.previewImage),
				alt: sub.previewImage?.alt || "",
			}));
			const printSetsWithImages = printSets.map((set) => ({
				...set,
				preview1: imageSet(set.images?.[0] as ShopImage)?.thumb,
				preview2: imageSet(set.images?.[1] as ShopImage)?.thumb,
				previewImage: previewUrl(set.previewImage),
			}));
			const productsWithImages = products.map((product) => ({
				...product,
				preview: previewUrl(product.previewImage),
			}));

			return {
				collection: {
					title: collection.title,
					slug,
					description: collection.description,
					previewImage: previewImageUrl,
					alt: collection.previewImage?.alt || "",
					parent: collection.parent,
				},
				subCollections: subCollectionsWithImages,
				printSets: printSetsWithImages,
				products: productsWithImages,
			};
		},
	};
}

export const sanityShop = createSanityShopAdapter();
