export const CART_METADATA_KEYS = {
	isCart: "isCart",
	itemCount: "cartItemCount",
	item: (index: number) => `cartItem_${index}`,
} as const;

export type CartItemMetadataPayload = {
	u: string;
	q: number;
	s?: number;
	w?: number;
	h?: number;
	i?: string[];
	b?: number;
	f?: number;
	c?: number;
	cw?: string;
};

export type LumaPrintsCartItemPayload = CartItemMetadataPayload &
	Required<Pick<CartItemMetadataPayload, "u" | "q" | "s" | "w" | "h">>;

export function decodeCartItemPayload(raw: unknown): LumaPrintsCartItemPayload | null {
	if (typeof raw !== "string" || !raw) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<CartItemMetadataPayload>;
		const hasRequiredCartFields = typeof parsed.u === "string" && typeof parsed.q === "number";
		const hasPaper =
			typeof parsed.s === "number" && typeof parsed.w === "number" && typeof parsed.h === "number";
		if (!hasRequiredCartFields || !hasPaper) {
			return null;
		}
		return parsed as LumaPrintsCartItemPayload;
	} catch {
		return null;
	}
}
