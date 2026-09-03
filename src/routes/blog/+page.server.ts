import { blogContent } from "$lib/server/blogContent.server";

export const load = async () => ({
	posts: await blogContent.loadIndex(),
});
