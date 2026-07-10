export interface PrintFeeConfig {
	platformFeePct: number;
	stripeFeePct: number;
	stripeFeeFixedCents: number;
}

export interface FeeBreakdown {
	stripeFee: number;
	platformFee: number;
	takeHome: number;
}

export interface MarginSummaryInput {
	retail: number;
	wholesale: number;
	feeConfig: PrintFeeConfig;
	wholesaleLabel?: string;
	lossLabel?: string;
}

export interface FramedMarginSummaryInput extends MarginSummaryInput {
	frameCost: number;
	frameMarkupMultiplier: number;
}

export function computeFeeBreakdown(
	retail: number,
	wholesale: number,
	feeConfig: PrintFeeConfig,
): FeeBreakdown {
	const stripeFee = retail * feeConfig.stripeFeePct + feeConfig.stripeFeeFixedCents / 100;
	const platformFee = retail * feeConfig.platformFeePct;
	const takeHome = retail - wholesale - stripeFee - platformFee;
	return { stripeFee, platformFee, takeHome };
}

export function buildMarginSummary({
	retail,
	wholesale,
	feeConfig,
	wholesaleLabel = `Wholesale: $${wholesale.toFixed(2)}`,
	lossLabel = "per unit",
}: MarginSummaryInput): string {
	if (retail <= 0) {
		return `${wholesaleLabel} · set a retail price to see take-home.`;
	}

	if (retail < wholesale) {
		const loss = wholesale - retail;
		const suffix = lossLabel ? ` ${lossLabel}` : "";
		return `${wholesaleLabel} · LOSS: $${loss.toFixed(2)}${suffix}.`;
	}

	const { stripeFee, platformFee, takeHome } = computeFeeBreakdown(retail, wholesale, feeConfig);
	const platformFeePart =
		feeConfig.platformFeePct > 0 ? ` · Platform fee: $${platformFee.toFixed(2)}` : "";

	if (takeHome <= 0) {
		return `${wholesaleLabel} · Stripe fee: $${stripeFee.toFixed(2)}${platformFeePart} · LOSS after fees: $${(-takeHome).toFixed(2)}`;
	}

	const takeHomePct = (takeHome / retail) * 100;
	return `${wholesaleLabel} · Stripe fee: $${stripeFee.toFixed(2)}${platformFeePart} · Take-home: $${takeHome.toFixed(2)} (${takeHomePct.toFixed(1)}%)`;
}

export function buildFramedMarginSummary({
	retail,
	wholesale,
	feeConfig,
	frameCost,
	frameMarkupMultiplier,
}: FramedMarginSummaryInput): string {
	const frameSurcharge = frameCost * frameMarkupMultiplier;
	const framedRetail = retail + frameSurcharge;
	const framedWholesale = wholesale + frameCost;
	const { stripeFee, takeHome } = computeFeeBreakdown(framedRetail, framedWholesale, feeConfig);
	const takeHomePct = (takeHome / framedRetail) * 100;

	return `Framed (0.875"): retail $${framedRetail.toFixed(2)} · wholesale $${framedWholesale.toFixed(2)} · Stripe $${stripeFee.toFixed(2)} · Take-home: $${takeHome.toFixed(2)} (${takeHomePct.toFixed(1)}%)`;
}
