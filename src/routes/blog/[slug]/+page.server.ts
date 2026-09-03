import { blogContent } from "$lib/server/blogContent.server";

export const load = async ({ params }) => ({
	post: await blogContent.loadPost(params.slug),
});
