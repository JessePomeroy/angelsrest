import { createClient } from '@sanity/client';
import { createImageUrlBuilder } from '@sanity/image-url';
import type { SanityImageSource } from '@sanity/image-url/lib/types/types';
import { env } from '$env/dynamic/public';

export const client = createClient({
	projectId: env.PUBLIC_SANITY_PROJECT_ID,
	dataset: env.PUBLIC_SANITY_DATASET || 'production',
	apiVersion: '2024-01-01',
	useCdn: true
});

const builder = createImageUrlBuilder(client);

export function urlFor(source: SanityImageSource) {
	return builder.image(source);
}
