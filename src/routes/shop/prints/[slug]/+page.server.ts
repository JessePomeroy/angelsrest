/**
 * Print Collection Detail - Server Load Function
 * 
 * Fetches a print collection, its sub-collections, print sets, and products.
 * 
 * Hierarchy:
 * - Collections can have parent collections (nested)
 * - Collections contain products and print sets
 */

import { error } from "@sveltejs/kit";
import { client } from "$lib/sanity/client";
import { previewUrl, imageSet } from "$lib/utils/images";

export async function load({ params }) {
	// Fetch the collection with parent reference
	const collection = await client.fetch(
		`*[_type == "printCollection" && slug.current == $slug][0]{
			title,
			description,
			previewImage,
			"parent": parent->{
				title,
				"slug": slug.current
			}
		}`,
		{ slug: params.slug },
	);

	if (!collection) {
		throw error(404, "Collection not found");
	}

	// Fetch sub-collections (children of this collection)
	const subCollections = await client.fetch(
		`*[_type == "printCollection" && references(*[_type == "printCollection" && slug.current == $slug]._id)] 
		| order(orderRank, title asc) {
			title,
			"slug": slug.current,
			previewImage
		}`,
		{ slug: params.slug },
	);

	// Fetch print sets in this collection
	const printSets = await client.fetch(
		`*[_type == "printSet" && references(*[_type == "printCollection" && slug.current == $slug]._id) && inStock == true] 
		| order(orderRank, title asc) {
			title,
			"slug": slug.current,
			images[0..1],
			previewImage,
			price
		}`,
		{ slug: params.slug },
	);

	// Fetch products in this collection
	const products = await client.fetch(
		`*[_type == "product" && references(*[_type == "printCollection" && slug.current == $slug]._id) && inStock == true] 
		| order(orderRank, title asc) {
			title,
			"slug": slug.current,
			"previewImage": images[0],
			price
		}`,
		{ slug: params.slug },
	);

	// Build URLs
	const previewImageUrl = previewUrl(collection.previewImage);

	const subCollectionsWithImages = subCollections.map((sub: any) => ({
		...sub,
		previewImage: previewUrl(sub.previewImage),
		alt: sub.previewImage?.alt || "",
	}));

	const printSetsWithImages = printSets.map((set: any) => ({
		...set,
		preview1: imageSet(set.images?.[0])?.thumb,
		preview2: imageSet(set.images?.[1])?.thumb,
		previewImage: previewUrl(set.previewImage),
	}));

	const productsWithImages = products.map((product: any) => ({
		...product,
		preview: previewUrl(product.previewImage),
	}));

	return {
		collection: {
			title: collection.title,
			description: collection.description,
			previewImage: previewImageUrl,
			alt: collection.previewImage?.alt || "",
			parent: collection.parent,
		},
		subCollections: subCollectionsWithImages,
		printSets: printSetsWithImages,
		products: productsWithImages,
	};
}
