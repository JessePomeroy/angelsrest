import { error } from "@sveltejs/kit";
import { client } from "$lib/sanity/client";

export interface CouponResult {
	discountAmount: number;
	appliedCoupon: string;
}

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
	const discountValue = Number(couponData.discountValue);
	if (!Number.isFinite(discountValue) || discountValue < 0) {
		throw error(400, "Invalid coupon configuration (negative or non-numeric discount)");
	}
	if (couponData.discountType === "percent" && discountValue > 100) {
		throw error(400, "Invalid coupon configuration (percent discount > 100)");
	}
	const priceCents = Math.round(price * 100);
	const discountCents =
		couponData.discountType === "percent"
			? Math.round((priceCents * discountValue) / 100)
			: Math.round(discountValue * 100);
	const clampedDiscountCents = Math.min(discountCents, priceCents);

	return {
		discountAmount: clampedDiscountCents / 100,
		appliedCoupon: couponData.code,
	};
}
