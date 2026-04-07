import { redirect } from "@sveltejs/kit";

export async function GET({ cookies }) {
	cookies.delete("__sanity_preview", { path: "/" });
	throw redirect(307, "/");
}
