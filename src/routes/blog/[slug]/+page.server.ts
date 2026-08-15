import { blogContent } from "$lib/server/blogContent.server";

export const load = async ({ params, locals }) => ({
	post: await blogContent.loadPost(params.slug, locals.isPreview),
});
