import { createImageUrlBuilder } from '@sanity/image-url';
import { PUBLIC_SANITY_PROJECT_ID, PUBLIC_SANITY_DATASET } from '$env/static/public';

export const imageUrlBuilder = createImageUrlBuilder({
  projectId: PUBLIC_SANITY_PROJECT_ID,
  dataset: PUBLIC_SANITY_DATASET,
});

export function urlFor(source: any) {
  return imageUrlBuilder.image(source);
}