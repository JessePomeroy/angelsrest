import { describe, expect, it } from "vitest";
import {
	applyGalleryFavoriteOverrides,
	beginGalleryFavoriteMutation,
	completeGalleryFavoriteMutation,
	createGalleryFavoriteState,
	rollbackGalleryFavoriteMutation,
} from "./favoriteState";

const images = [
	{ _id: "image-a", filename: "a.jpg", isFavorite: false },
	{ _id: "image-b", filename: "b.jpg", isFavorite: true },
];

describe("gallery favorite optimistic state", () => {
	it("overlays favorite values without mutating server images", () => {
		const started = beginGalleryFavoriteMutation(createGalleryFavoriteState(), "image-a", false);
		expect(started).not.toBeNull();
		if (!started) return;

		const displayed = applyGalleryFavoriteOverrides(images, started.state);
		expect(displayed.map((image) => image.isFavorite)).toEqual([true, true]);
		expect(images[0].isFavorite).toBe(false);
	});

	it("rolls back only the failed image and preserves a concurrent image mutation", () => {
		const first = beginGalleryFavoriteMutation(createGalleryFavoriteState(), "image-a", false);
		expect(first).not.toBeNull();
		if (!first) return;
		const second = beginGalleryFavoriteMutation(first.state, "image-b", true);
		expect(second).not.toBeNull();
		if (!second) return;

		const afterFirstFailure = rollbackGalleryFavoriteMutation(second.state, first.mutation);
		expect(afterFirstFailure.overrides.has("image-a")).toBe(false);
		expect(afterFirstFailure.overrides.get("image-b")).toBe(false);
		expect(afterFirstFailure.pendingImageIds.has("image-a")).toBe(false);
		expect(afterFirstFailure.pendingImageIds.has("image-b")).toBe(true);
	});

	it("keeps a successful override and permits the next mutation for that image", () => {
		const first = beginGalleryFavoriteMutation(createGalleryFavoriteState(), "image-a", false);
		expect(first).not.toBeNull();
		if (!first) return;
		const completed = completeGalleryFavoriteMutation(first.state, first.mutation);

		expect(completed.overrides.get("image-a")).toBe(true);
		expect(completed.pendingImageIds.has("image-a")).toBe(false);
		const second = beginGalleryFavoriteMutation(completed, "image-a", true);
		expect(second?.mutation.nextValue).toBe(false);
	});

	it("restores the prior successful override when a later mutation fails", () => {
		const first = beginGalleryFavoriteMutation(createGalleryFavoriteState(), "image-a", false);
		expect(first).not.toBeNull();
		if (!first) return;
		const completed = completeGalleryFavoriteMutation(first.state, first.mutation);
		const second = beginGalleryFavoriteMutation(completed, "image-a", true);
		expect(second).not.toBeNull();
		if (!second) return;

		const rolledBack = rollbackGalleryFavoriteMutation(second.state, second.mutation);
		expect(rolledBack.overrides.get("image-a")).toBe(true);
		expect(rolledBack.pendingImageIds.has("image-a")).toBe(false);
	});

	it("prevents overlapping mutations for the same image", () => {
		const first = beginGalleryFavoriteMutation(createGalleryFavoriteState(), "image-a", false);
		expect(first).not.toBeNull();
		if (!first) return;

		expect(beginGalleryFavoriteMutation(first.state, "image-a", true)).toBeNull();
	});
});
