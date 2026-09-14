import type { CartItem } from "./cart";
import type { ResolvedPrintConfiguration } from "./printConfigurator";

/** Snapshot only the resolved selection; each page supplies its own product and image identity. */
export function printConfigurationCartFields(
	configuration: ResolvedPrintConfiguration,
): Omit<CartItem, "id" | "productSlug" | "type" | "title" | "imageUrl" | "imageUrls"> {
	return {
		paperName: configuration.paper.name,
		paperSubcategoryId: configuration.paperSubcategoryId,
		paperWidth: configuration.size.width,
		paperHeight: configuration.size.height,
		paperSlug: configuration.paperSlug,
		sizeSlug: configuration.sizeSlug,
		borderWidthValue: configuration.borderWidthValue,
		frameValue: configuration.frameValue,
		...(configuration.borderWidth ? { borderWidth: configuration.borderWidth } : {}),
		...(configuration.frameSubcategoryId
			? { frameSubcategoryId: configuration.frameSubcategoryId }
			: {}),
		...(configuration.canvas
			? {
					canvasSubcategoryId: configuration.canvas.subcategoryId,
					canvasWrapHex: configuration.canvas.wrapHex,
				}
			: {}),
		quantity: 1,
		unitPriceCents: Math.round(configuration.displayPrice * 100),
	};
}
