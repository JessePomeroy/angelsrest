import type { FunctionReturnType } from "convex/server";
import type { api } from "$convex/api";

export type ClientPrintRefundPageData = {
	siteUrl: string;
	enabled: boolean;
	requestToken: string;
	page: FunctionReturnType<typeof api.orders.getClientPrintRefundPage> | null;
};
export function clientPrintRefundPath(siteUrl: string) {
	return `/portal/refunds/${encodeURIComponent(siteUrl)}`;
}
export function refundCents(value: string) {
	if (!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(value)) return null;
	const [whole, fraction = ""] = value.split(".");
	return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
