/**
 * Shop Index - Server Load Function
 * 
 * Fetches data for the shop page:
 * 1. Products - individual items for sale
 * 2. Print Collections - groups of prints (hierarchical, can be nested)
 * 3. Print Sets - curated bundles of multiple images sold together
 * 
 * Products show under different tabs:
 * - All: products not in collections
 * - Prints: collections, sets, and individual prints without collections
 * - Other categories: products in that category
 */

import { client } from "$lib/sanity/client";
import { previewUrl, imageSet } from "$lib/utils/images";
import type { Product, PrintCollection, PrintSet } from "$lib/types/shop";

export async function load() {
	// Fetch products that are in stock
	const products = await client.fetch(`
		*[_type == "product" && inStock == true] 
		| order(orderRank, featured desc, title asc) {
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

	// Build optimized product URLs
	const productsWithImages = (products as Product[]).map((product) => ({
		...product,
		preview: previewUrl(product.previewImage),
	}));

	// Fetch top-level collections only (no parent = root level)
	const collections = await client.fetch(`
		*[_type == "printCollection" && !defined(parent)] 
		| order(orderRank, title asc) {
			title,
			"slug": slug.current,
			previewImage,
			description
		}
	`);

	// Build collection preview URLs
	const collectionsWithImages = (collections as PrintCollection[]).map((collection) => ({
		...collection,
		alt: collection.previewImage?.alt || '',
		previewImage: previewUrl(collection.previewImage),
	}));

	// Fetch top-level print sets (no parent)
	const printSets = await client.fetch(`
		*[_type == "printSet" && !defined(parent) && inStock == true] 
		| order(orderRank, featured desc, title asc) {
			title,
			"slug": slug.current,
			images[0..1],
			previewImage,
			price,
			description
		}
	`);

	// Build print set URLs (first two images for preview)
	const printSetsWithImages = (printSets as any[]).map((set) => ({
		...set,
		preview1: imageSet(set.images?.[0])?.thumb,
		preview2: imageSet(set.images?.[1])?.thumb,
		previewImage: previewUrl(set.previewImage),
	}));

	return {
		products: productsWithImages,
		collections: collectionsWithImages,
		printSets: printSetsWithImages,
	};
}
