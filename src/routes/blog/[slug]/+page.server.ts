import { error } from "@sveltejs/kit";
import { client } from "$lib/sanity/client";

export const load = async ({ params }) => {
	const post = await client.fetch(
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
