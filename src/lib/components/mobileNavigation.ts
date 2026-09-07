// A rotated phone still needs persistent navigation even above the desktop width.
export const MOBILE_NAV_QUERY =
	"(max-width: 767px), (pointer: coarse) and (orientation: landscape) and (max-height: 500px)";

// Each layout owns its measurements; no browser/server singleton or DOM lookup.
export const MOBILE_CHROME = Symbol("mobile-chrome");
export interface MobileChrome {
	bottomNavHeight: number | undefined;
	purchaseBarHeight: number;
}
