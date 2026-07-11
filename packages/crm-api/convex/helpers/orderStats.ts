export function resolveBoundedOrderStatsScan<T>(
	rowsWithSentinel: readonly T[],
	scanLimit: number,
): { orders: T[]; isTruncated: boolean } {
	if (!Number.isInteger(scanLimit) || scanLimit < 1) {
		throw new Error("Order stats scan limit must be a positive integer");
	}
	return {
		orders: rowsWithSentinel.slice(0, scanLimit),
		isTruncated: rowsWithSentinel.length > scanLimit,
	};
}
