import { error } from "@sveltejs/kit";
import { getSanityClient } from "$lib/sanity/client";

export const load = async ({ params, locals }) => {
	const sanity = getSanityClient(locals.isPreview);
	const post = await sanity.fetch(
		`
    *[_type == "post" && slug.current == $slug][0] {
      _id,
      title,
      slug,
      publishedAt,
      mainImage,
      postType,
      brief,
      approach,
      result,
      gearUsed,
      body,
      author->{
        name,
        image,
        bio
      },
      categories[]->{
        title
      }
    }
  `,
		{ slug: params.slug },
	);

	if (!post) {
		throw error(404, "Post not found");
	}

	return { post };
};
