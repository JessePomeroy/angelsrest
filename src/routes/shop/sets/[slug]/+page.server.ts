/**
 * Print Set Detail — Server Load Function
 *
 * Queries lumaPrintSetV2 for the set data, images, and variants.
 * Falls back to V1 printSet for legacy sets not yet migrated.
 */

import { error } from "@sveltejs/kit";
import { getSanityClient } from "$lib/sanity/client";
import { imageSet, previewUrl } from "$lib/utils/images";

const V2_QUERY = `
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

const V1_QUERY = `
  *[_type == "printSet" && slug.current == $slug][0]{
    title,
    description,
    previewImage,
    images,
    price,
    availablePapers,
    "parent": parent->{
      title,
      "slug": slug.current
    }
  }
`;

export async function load({ params, locals }) {
	const slug = params.slug;
	const sanity = getSanityClient(locals.isPreview);

	// Try V2 first
	const v2Set = await sanity.fetch(V2_QUERY, { slug });

	if (v2Set) {
		const preview = previewUrl(v2Set.previewImage);
		const images = (v2Set.images || []).map((img: any) => imageSet(img)).filter(Boolean);

		return {
			setType: "v2" as const,
			printSet: {
				title: v2Set.title,
				slug,
				description: v2Set.description,
				previewImage: preview,
				variants: v2Set.variants || [],
				bordersEnabled: v2Set.bordersEnabled ?? true,
				framedEnabled: v2Set.framedEnabled ?? false,
				frameMarkupMultiplier: v2Set.frameMarkupMultiplier ?? 2,
				inStock: v2Set.inStock ?? true,
				parent: v2Set.parent,
			},
			images,
		};
	}

	// Fall back to V1
	const v1Set = await sanity.fetch(V1_QUERY, { slug });

	if (!v1Set) throw error(404, "Print set not found");

	const preview = previewUrl(v1Set.previewImage);
	const images = (v1Set.images || []).map((img: any) => imageSet(img)).filter(Boolean);

	return {
		setType: "v1" as const,
		printSet: {
			title: v1Set.title,
			slug,
			description: v1Set.description,
			previewImage: preview,
			price: v1Set.price,
			availablePapers: v1Set.availablePapers || [],
			parent: v1Set.parent,
		},
		images,
	};
}
