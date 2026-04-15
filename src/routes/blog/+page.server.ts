import { client } from "$lib/sanity/client";

export const load = async () => {
	const posts = await client.fetch(`
    *[_type == "post"] | order(publishedAt desc) {
      _id,
      title,
      slug,
      publishedAt,
      mainImage,
      postType,
      "excerpt": array::join(string::split(pt::text(body), "")[0..200], "") + "...",
      author->{
        name,
        image
      },
      categories[]->{
        title
      }
    }
  `);

	return { posts };
};
