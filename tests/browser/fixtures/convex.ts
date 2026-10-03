import { getFunctionName, type FunctionArgs, type FunctionReturnType } from "convex/server";
import { api } from "../../../packages/crm-api/convex/_generated/api";
let galleryPages: ((args: FunctionArgs<typeof api.galleries.getImagesPage>) => Promise<FunctionReturnType<typeof api.galleries.getImagesPage>>) | undefined;
export function configureGalleryPages(handler: NonNullable<typeof galleryPages>) {
	galleryPages = handler;
	return () => { if (galleryPages === handler) galleryPages = undefined; };
}
let favoriteMutation: ((args: FunctionArgs<typeof api.galleries.updateImage>) => Promise<FunctionReturnType<typeof api.galleries.updateImage>>) | undefined;
export function configureFavoriteMutation(handler: NonNullable<typeof favoriteMutation>) {
 favoriteMutation = handler;
 return () => { if (favoriteMutation === handler) favoriteMutation = undefined; };
}
// Fail closed: interaction fixtures must never write to a provider.
export function setupConvex(_url: string) {}
export function useConvexClient() {
	return {
		async query(ref: typeof api.galleries.getImagesPage, args: FunctionArgs<typeof api.galleries.getImagesPage>) {
			if (getFunctionName(ref) !== "galleries:getImagesPage" || !galleryPages) throw new Error("Unexpected Convex query in browser fixture");
			return galleryPages(args);
		},
		async mutation(ref: typeof api.galleries.updateImage, args: FunctionArgs<typeof api.galleries.updateImage>) {
   if (getFunctionName(ref) !== "galleries:updateImage" || !favoriteMutation) throw new Error("Unexpected Convex mutation in browser fixture");
   return favoriteMutation(args);
		},
	};
}
export { api };

export function useQuery() {
	throw new Error("Unexpected Convex query in browser fixture");
}

export function usePaginatedQuery() {
	throw new Error("Unexpected paginated Convex query in browser fixture");
}
