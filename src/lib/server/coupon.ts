/**
 * Coupon validation and discount calculation.
 *
 * Extracted from the single-product checkout route so the logic is
 * testable and reusable when cart-level coupons land.
 */

import { error } from "@sveltejs/kit";
import { client } from "$lib/sanity/client";

export interface CouponResult {
	discountAmount: number;
	appliedCoupon: string;
}

/**
 * Validate a coupon code against a product and return the discount.
 *
 * Throws SvelteKit `error()` with a 400 status if the coupon is
 * invalid, exhausted, or not applicable to the given product.
 */
export async function validateAndApplyCoupon(
	couponCode: string,
	productSlug: string,
	productCategory: string | undefined,
	price: number,
): Promise<CouponResult> {
	const couponData = await client.fetch(
		`*[_type == "coupon" && code == $code && active == true][0]{
			code,
			discountType,
			discountValue,
			allowedCategories,
			"allowedProductSlugs": allowedProducts[]->slug.current,
			maxUses,
			currentUses
		}`,
		{ code: couponCode.toUpperCase() },
	);

	if (!couponData) {
		throw error(400, "Invalid coupon code");
	}

	if (couponData.maxUses && couponData.currentUses >= couponData.maxUses) {
		throw error(400, "Coupon code has reached its usage limit");
	}

	const isAllowed =
		!couponData.allowedCategories?.length ||
		couponData.allowedCategories.includes(productCategory) ||
		(couponData.allowedProductSlugs || []).includes(productSlug);

	if (!isAllowed) {
		throw error(400, "This coupon is not valid for this product");
	}

	const discountAmount =
		couponData.discountType === "percent"
			? (price * couponData.discountValue) / 100
			: couponData.discountValue;

	return { discountAmount, appliedCoupon: couponData.code };
}
