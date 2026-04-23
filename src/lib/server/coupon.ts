/**
 * Coupon validation and discount calculation.
 *
 * Extracted from the single-product checkout route so the logic is
 * testable and reusable when cart-level coupons land.
 *
 * Audit H9 — this now rejects `percent` coupons with a `discountValue`
 * outside [0, 100] and rounds every computation to cent precision so
 * float drift can't propagate into the final charge.
 */

import { error } from "@sveltejs/kit";
import { client } from "$lib/sanity/client";

export interface CouponResult {
	/** Discount amount in dollars, rounded to cent precision. */
	discountAmount: number;
	appliedCoupon: string;
}

/**
 * Validate a coupon code against a product and return the discount.
 *
 * Throws SvelteKit `error()` with a 400 status if the coupon is
 * invalid, exhausted, not applicable to the given product, or has an
 * out-of-range discount value.
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

	// Audit H9: hard-reject out-of-range discount values. The Sanity
	// schema currently accepts any positive number — a misconfigured
	// coupon with discountValue: 150 as a percent would pay customers
	// to buy from us. Reject at the checkout boundary as a belt-and-
	// suspenders defense until the studio schema also clamps.
	const discountValue = Number(couponData.discountValue);
	if (!Number.isFinite(discountValue) || discountValue < 0) {
		throw error(400, "Invalid coupon configuration (negative or non-numeric discount)");
	}
	if (couponData.discountType === "percent" && discountValue > 100) {
		throw error(400, "Invalid coupon configuration (percent discount > 100)");
	}

	// Compute in cents then convert back to dollars, so one rounding
	// happens at the boundary instead of accumulated float drift.
	const priceCents = Math.round(price * 100);
	const discountCents =
		couponData.discountType === "percent"
			? Math.round((priceCents * discountValue) / 100)
			: Math.round(discountValue * 100);

	// Discount can't exceed the price itself.
	const clampedDiscountCents = Math.min(discountCents, priceCents);

	return {
		discountAmount: clampedDiscountCents / 100,
		appliedCoupon: couponData.code,
	};
}
