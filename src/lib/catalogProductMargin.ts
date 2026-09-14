import type {
	CatalogProductMarginCalculator,
	CatalogProductMarginEstimate,
	CatalogProductVariantOptionResolver,
} from "@jessepomeroy/admin";
import {
	getFrameWholesaleCost,
	getWholesaleCost,
	isCanvasPaper,
	PAPER_DROPDOWN_OPTIONS,
	SIZE_DROPDOWN_OPTIONS,
} from "@jessepomeroy/print-catalog";
import {
	buildFramedMarginSummary,
	buildMarginSummary,
	type PrintFeeConfig,
} from "@jessepomeroy/print-catalog/pricing";

const ANGELS_REST_PRINT_FEES: PrintFeeConfig = {
	platformFeePct: 0,
	stripeFeePct: 0.029,
	stripeFeeFixedCents: 30,
};

const missingOptions: CatalogProductMarginEstimate = {
	summary: "Choose a material and size to see cost and profit.",
};

const catalogMaterials = PAPER_DROPDOWN_OPTIONS.map(({ title, value }) => ({
	label: title,
	value,
}));
const catalogSizes = SIZE_DROPDOWN_OPTIONS.map(({ title, value }) => ({
	label: title,
	value,
}));

/** Supplies human labels and only the sizes supported by the selected material. */
export const resolveCatalogProductVariantOptions: CatalogProductVariantOptionResolver = ({
	materialOptionKey,
}) => ({
	materials: catalogMaterials,
	sizes: !materialOptionKey
		? catalogSizes
		: catalogMaterials.some(({ value }) => value === materialOptionKey)
			? catalogSizes.filter(({ value }) => getWholesaleCost(materialOptionKey, value) !== null)
			: [],
});

/**
 * Reuses the catalog margin calculator at the host-owned boundary.
 * Prices enter the shared editor as cents; print-catalog calculations use USD.
 */
export const calculateCatalogProductMargin: CatalogProductMarginCalculator = (input) => {
	if (!input.materialOptionKey || !input.sizeOptionKey) return missingOptions;
	const perPrintWholesale = getWholesaleCost(input.materialOptionKey, input.sizeOptionKey);
	if (perPrintWholesale === null) {
		return { summary: "Cost is not available for this material and size." };
	}
	const retail = (input.retailPriceCents ?? 0) / 100;
	if (input.productKind === "print_set") {
		if (input.setMemberCount === 0) {
			return {
				summary: `Cost per print: $${perPrintWholesale.toFixed(2)} · add prints to the set to calculate set profit.`,
			};
		}
		const wholesale = perPrintWholesale * input.setMemberCount;
		return {
			summary: buildMarginSummary({
				retail,
				wholesale,
				feeConfig: ANGELS_REST_PRINT_FEES,
				wholesaleLabel: `Cost: $${wholesale.toFixed(2)} ($${perPrintWholesale.toFixed(2)} × ${input.setMemberCount} prints)`,
				lossLabel: "for set",
			}),
		};
	}

	const result: CatalogProductMarginEstimate = {
		summary: buildMarginSummary({
			retail,
			wholesale: perPrintWholesale,
			feeConfig: ANGELS_REST_PRINT_FEES,
			wholesaleLabel: `Cost: $${perPrintWholesale.toFixed(2)}`,
		}),
	};
	if (
		input.frameMarkupMultiplier !== undefined &&
		Number.isFinite(input.frameMarkupMultiplier) &&
		input.frameMarkupMultiplier > 0 &&
		retail > 0 &&
		!isCanvasPaper(input.materialOptionKey)
	) {
		const frameCost = getFrameWholesaleCost(input.sizeOptionKey);
		if (frameCost !== null) {
			result.framedSummary = buildFramedMarginSummary({
				retail,
				wholesale: perPrintWholesale,
				feeConfig: ANGELS_REST_PRINT_FEES,
				frameCost,
				frameMarkupMultiplier: input.frameMarkupMultiplier,
			});
		}
	}
	return result;
};
