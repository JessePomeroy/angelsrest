import {
	bindCustomerCheckout,
	ownsCustomerCheckout,
} from "@jessepomeroy/admin/server/customer-services";
import type { Cookies } from "@sveltejs/kit";
import { dev } from "$app/environment";

export function bindCheckoutSession(cookies: Cookies, sessionId: string): void {
	bindCustomerCheckout(cookies, sessionId, !dev);
}
export function isCheckoutSessionOwner(
	cookies: Cookies,
	sessionId: string | null | undefined,
): boolean {
	return ownsCustomerCheckout(cookies, sessionId);
}
