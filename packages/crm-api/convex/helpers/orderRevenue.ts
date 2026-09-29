import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isNonnegativeSafeInteger, isStripeCurrency } from "./stripeFeeCapture";

export function orderRevenueContribution(order: Doc<"orders">) {
	const invalid = !isNonnegativeSafeInteger(order.total);
	return { orderId: order._id, siteUrl: order.siteUrl,
		day: new Date(order._creationTime).toISOString().slice(0, 10),
		currency: isStripeCurrency(order.stripePaymentCurrency) ? order.stripePaymentCurrency : "unknown",
		amount: invalid ? "0" : String(order.total), invalid,
	};
}

/** Paid gross, not net revenue: refunds/status changes do not subtract the original charge. */
export async function recordOrderRevenue(ctx: MutationCtx, order: Doc<"orders">) {
	const contribution = orderRevenueContribution(order);
	const existing = await ctx.db.query("orderRevenueContributions").withIndex("by_orderId", (q) => q.eq("orderId", order._id)).unique();
	if (existing) {
		if (!sameContribution(existing, contribution)) throw new Error("Recorded order financial identity changed");
		return;
	}
	for (const day of ["all", contribution.day]) {
		const row = await ctx.db.query("orderRevenueTotals")
			.withIndex("by_siteUrl_and_day_and_currency", (q) => q.eq("siteUrl", order.siteUrl).eq("day", day).eq("currency", contribution.currency)).unique();
		const values = { amount: String(BigInt(row?.amount ?? "0") + BigInt(contribution.amount)),
			count: (row?.count ?? 0) + 1, invalidCount: (row?.invalidCount ?? 0) + Number(contribution.invalid) };
		if (row) await ctx.db.patch(row._id, values);
		else await ctx.db.insert("orderRevenueTotals", { siteUrl: order.siteUrl, day, currency: contribution.currency, ...values });
	}
	const state = await ctx.db.query("orderRevenueBackfills").withIndex("by_siteUrl", (q) => q.eq("siteUrl", order.siteUrl)).unique();
	const verified = state?.phase === "verify" || state?.phase === "compare";
	if (verified) await recordVerification(ctx, contribution);
	await ctx.db.insert("orderRevenueContributions", { ...contribution, verified });
}

async function recordVerification(ctx: MutationCtx, contribution: ReturnType<typeof orderRevenueContribution>) {
	for (const day of ["all", contribution.day]) {
		const row = await ctx.db.query("orderRevenueVerificationTotals")
			.withIndex("by_siteUrl_and_day_and_currency", (q) => q.eq("siteUrl", contribution.siteUrl).eq("day", day).eq("currency", contribution.currency)).unique();
		const values = { amount: String(BigInt(row?.amount ?? "0") + BigInt(contribution.amount)),
			count: (row?.count ?? 0) + 1, invalidCount: (row?.invalidCount ?? 0) + Number(contribution.invalid) };
		if (row) await ctx.db.patch(row._id, values);
		else await ctx.db.insert("orderRevenueVerificationTotals", { siteUrl: contribution.siteUrl, day, currency: contribution.currency, ...values });
	}
}

export function sameContribution(left: ReturnType<typeof orderRevenueContribution>, right: ReturnType<typeof orderRevenueContribution>) {
	return left.orderId === right.orderId && left.siteUrl === right.siteUrl && left.day === right.day
		&& left.currency === right.currency && left.amount === right.amount && left.invalid === right.invalid;
}

/** Cursor is an expected value: replayed batches cannot advance or count twice. */
export async function advanceOrderRevenueBackfill(ctx: MutationCtx, siteUrl: string, expectedCursor: string | null, expectedPhase: "copy" | "verify" | "compare") {
	let state = await ctx.db.query("orderRevenueBackfills").withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl)).unique();
	if (!state) {
		if (expectedCursor !== null || expectedPhase !== "copy") throw new Error("Start with the first copy batch");
		const id = await ctx.db.insert("orderRevenueBackfills", { siteUrl, phase: "copy", cursor: null, copied: 0, verified: 0 });
		state = await ctx.db.get(id);
	}
	if (!state) throw new Error("Backfill is unavailable");
	if (state.phase !== expectedPhase || state.cursor !== expectedCursor) return state;
	if (state.phase === "compare") {
		const page = await ctx.db.query("orderRevenueTotals").withIndex("by_siteUrl_and_day_and_currency", (q) => q.eq("siteUrl", siteUrl))
			.paginate({ numItems: 100, cursor: state.cursor, maximumBytesRead: 1_000_000 });
		for (const row of page.page) {
			const expected = await ctx.db.query("orderRevenueVerificationTotals")
				.withIndex("by_siteUrl_and_day_and_currency", (q) => q.eq("siteUrl", siteUrl).eq("day", row.day).eq("currency", row.currency)).unique();
			if (!expected || expected.amount !== row.amount || expected.count !== row.count || expected.invalidCount !== row.invalidCount) {
				throw new Error("Aggregate comparison failed; dashboard remains on the bounded scan");
			}
		}
		const update = { phase: page.isDone ? "ready" as const : "compare" as const, cursor: page.isDone ? null : page.continueCursor };
		await ctx.db.patch(state._id, update);
		return { ...state, ...update };
	}
	const batch = await ctx.db.query("orders").withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
		.paginate({ numItems: 100, cursor: state.cursor, maximumBytesRead: 1_000_000 });
	for (const order of batch.page) {
		if (state.phase === "copy") await recordOrderRevenue(ctx, order);
		else {
			const saved = await ctx.db.query("orderRevenueContributions").withIndex("by_orderId", (q) => q.eq("orderId", order._id)).unique();
			if (!saved || !sameContribution(saved, orderRevenueContribution(order))) throw new Error("Revenue verification failed; dashboard remains on the bounded scan");
			if (!saved.verified) {
				await recordVerification(ctx, orderRevenueContribution(order));
				await ctx.db.patch(saved._id, { verified: true });
			}
		}
	}
	const update = { cursor: batch.isDone ? null : batch.continueCursor,
		phase: batch.isDone ? (state.phase === "copy" ? "verify" as const : "compare" as const) : state.phase,
		copied: state.copied + (state.phase === "copy" ? batch.page.length : 0),
		verified: state.verified + (state.phase === "verify" ? batch.page.length : 0) };
	await ctx.db.patch(state._id, update);
	return { ...state, ...update };
}

export async function readOrderRevenue(ctx: QueryCtx, siteUrl: string) {
	const state = await ctx.db.query("orderRevenueBackfills").withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl)).unique();
	if (state?.phase !== "ready") return null;
	const today = new Date(); today.setUTCHours(0, 0, 0, 0);
	const week = new Date(today); week.setUTCDate(today.getUTCDate() - today.getUTCDay());
	const month = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
	const chartStart = new Date(today); chartStart.setUTCDate(today.getUTCDate() - 29);
	const dayKey = (date: Date) => date.toISOString().slice(0, 10);
	const from = dayKey(new Date(Math.min(month.getTime(), week.getTime(), chartStart.getTime())));
	const totals = await ctx.db.query("orderRevenueTotals")
		.withIndex("by_siteUrl_and_day_and_currency", (q) => q.eq("siteUrl", siteUrl).eq("day", "all")).take(201);
	const days = await ctx.db.query("orderRevenueTotals")
		.withIndex("by_siteUrl_and_day_and_currency", (q) => q.eq("siteUrl", siteUrl).gte("day", from).lte("day", dayKey(today))).take(6501);
	// Fail visibly instead of silently truncating unusual/corrupt currency sets.
	if (totals.length > 200 || days.length > 6500) throw new Error("Revenue currency summary limit exceeded");
	let unknownCurrencyOrderCount = 0;
	let invalidGrossAmountOrderCount = 0;
	const grossPayments: Array<{ currency: string; orderCount: number; todayMinorUnits: number; weekMinorUnits: number; monthMinorUnits: number; allTimeMinorUnits: number }> = [];
	for (const total of totals) {
		if (total.currency === "unknown") { unknownCurrencyOrderCount += total.count; continue; }
		const amount = Number(total.amount);
		if (!Number.isSafeInteger(amount)) { invalidGrossAmountOrderCount += total.count; continue; }
		invalidGrossAmountOrderCount += total.invalidCount;
		if (total.count === total.invalidCount) continue;
		const relevant = days.filter((row) => row.currency === total.currency);
		const sumSince = (start: string) => relevant.filter((row) => row.day >= start).reduce((sum, row) => sum + Number(row.amount), 0);
		grossPayments.push({ currency: total.currency, orderCount: total.count - total.invalidCount,
			allTimeMinorUnits: amount, todayMinorUnits: sumSince(dayKey(today)), weekMinorUnits: sumSince(dayKey(week)), monthMinorUnits: sumSince(dayKey(month)) });
	}
	const chartDays = Array.from({ length: 30 }, (_, index) => dayKey(new Date(chartStart.getTime() + index * 86400000)));
	const dailyGrossPayments = grossPayments.flatMap(({ currency }) => chartDays.map((date) => ({ date, currency,
		amountMinorUnits: Number(days.find((row) => row.day === date && row.currency === currency)?.amount ?? "0") })));
	const sumSince = (start: string) => days.filter((row) => row.day >= start).reduce((amount, row) => amount + Number(row.amount), 0);
	const legacyRevenueCurrency = grossPayments.length === 1 && !unknownCurrencyOrderCount && !invalidGrossAmountOrderCount ? grossPayments[0].currency : undefined;
	return { stats: { totalOrders: totals.reduce((count, row) => count + row.count, 0), isTruncated: false, scanLimit: 0,
		todayRevenue: sumSince(dayKey(today)), weekRevenue: sumSince(dayKey(week)), monthRevenue: sumSince(dayKey(month)), allTimeRevenue: totals.reduce((amount, row) => amount + Number(row.amount), 0),
		legacyRevenueCurrency, legacyRevenueCurrencyUnsafe: legacyRevenueCurrency === undefined },
		grossPayments, dailyGrossPayments, unknownCurrencyOrderCount, invalidGrossAmountOrderCount,
		dailyRevenue: chartDays.map((date) => ({ date, amount: days.filter((row) => row.day === date).reduce((sum, row) => sum + Number(row.amount), 0) })) };
}
