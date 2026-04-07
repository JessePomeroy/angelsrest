import { client } from "$lib/sanity/client";

export async function load() {
	const inquiries = await client.fetch(`
		*[_type == "inquiry"] | order(submittedAt desc) {
			_id, name, email, phone, subject, message, status, submittedAt
		}
	`);

	return {
		inquiries,
	};
}
