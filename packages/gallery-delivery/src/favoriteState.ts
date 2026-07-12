export type GalleryFavoriteOptimisticState = {
	overrides: ReadonlyMap<string, boolean>;
	pendingImageIds: ReadonlySet<string>;
};

export type GalleryFavoriteMutation = {
	imageId: string;
	nextValue: boolean;
	previousOverride: { present: false } | { present: true; value: boolean };
};

export function createGalleryFavoriteState(): GalleryFavoriteOptimisticState {
	return { overrides: new Map(), pendingImageIds: new Set() };
}

export function applyGalleryFavoriteOverrides<T extends { _id: string; isFavorite: boolean }>(
	images: readonly T[],
	state: GalleryFavoriteOptimisticState,
): T[] {
	return images.map((image) => {
		if (!state.overrides.has(image._id)) return image;
		return { ...image, isFavorite: state.overrides.get(image._id) ?? false };
	});
}

/**
 * Start one optimistic mutation per image. Mutations for different images may
 * run concurrently, while a second mutation for the same image is ignored
 * until the first settles so response order cannot invert the final state.
 */
export function beginGalleryFavoriteMutation(
	state: GalleryFavoriteOptimisticState,
	imageId: string,
	currentValue: boolean,
): { state: GalleryFavoriteOptimisticState; mutation: GalleryFavoriteMutation } | null {
	if (state.pendingImageIds.has(imageId)) return null;

	const previousOverride = state.overrides.has(imageId)
		? { present: true as const, value: state.overrides.get(imageId) ?? false }
		: { present: false as const };
	const nextValue = !currentValue;
	const overrides = new Map(state.overrides);
	const pendingImageIds = new Set(state.pendingImageIds);
	overrides.set(imageId, nextValue);
	pendingImageIds.add(imageId);

	return {
		state: { overrides, pendingImageIds },
		mutation: { imageId, nextValue, previousOverride },
	};
}

export function completeGalleryFavoriteMutation(
	state: GalleryFavoriteOptimisticState,
	mutation: GalleryFavoriteMutation,
): GalleryFavoriteOptimisticState {
	if (!state.pendingImageIds.has(mutation.imageId)) return state;
	const pendingImageIds = new Set(state.pendingImageIds);
	pendingImageIds.delete(mutation.imageId);
	return { overrides: state.overrides, pendingImageIds };
}

export function rollbackGalleryFavoriteMutation(
	state: GalleryFavoriteOptimisticState,
	mutation: GalleryFavoriteMutation,
): GalleryFavoriteOptimisticState {
	if (!state.pendingImageIds.has(mutation.imageId)) return state;

	const overrides = new Map(state.overrides);
	if (mutation.previousOverride.present) {
		overrides.set(mutation.imageId, mutation.previousOverride.value);
	} else {
		overrides.delete(mutation.imageId);
	}
	const pendingImageIds = new Set(state.pendingImageIds);
	pendingImageIds.delete(mutation.imageId);
	return { overrides, pendingImageIds };
}
