import { createImageUrlBuilder } from '@sanity/image-url';

export const imageUrlBuilder = createImageUrlBuilder({
  projectId: import.meta.env.VITE_SANITY_PROJECT_ID,
  dataset: 'production',
});

export function urlFor(source: any) {
  return imageUrlBuilder.image(source);
}