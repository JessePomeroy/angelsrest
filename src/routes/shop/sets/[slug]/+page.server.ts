/**
 * Print Set Detail — Server Load Function
 *
 * Queries lumaPrintSetV2 for the set data, images, and variants.
 */

import { error } from "@sveltejs/kit";
import { getSanityClient } from "$lib/sanity/client.server";
import { imageSet, previewUrl } from "$lib/utils/images";

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

export async function load({ params, locals }) {
	const slug = params.slug;
	const sanity = getSanityClient(locals.isPreview);
	const printSet = await sanity.fetch(PRINT_SET_QUERY, { slug });

	if (!printSet) throw error(404, "Print set not found");

	const preview = previewUrl(printSet.previewImage);
	const images = (printSet.images || []).map((img: any) => imageSet(img)).filter(Boolean);

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
}
