import { client as sanityClient } from "$lib/sanity/client";

export async function load() {
	let newInquiryCount = 0;
	try {
		newInquiryCount = await sanityClient.fetch<number>(
			'count(*[_type == "inquiry" && status == "new"])',
		);
	} catch (err) {
		console.error("Failed to fetch inquiry count:", err);
	}

	return {
		newInquiryCount,
	};
}
