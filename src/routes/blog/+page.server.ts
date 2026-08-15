import { blogContent } from "$lib/server/blogContent.server";

export const load = async ({ locals }) => ({
	posts: await blogContent.loadIndex(locals.isPreview),
});
