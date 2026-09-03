import { blogContent } from "$lib/server/current/blogContent.server";

export const load = async () => ({
	posts: await blogContent.loadIndex(),
});
