import { describe, expect, it } from "vitest";
import { FulfillmentValidationError } from "../server/fulfillmentValidationError";
import { buildRecipientFromShipping } from "../server/webhookDecoder";

describe("buildRecipientFromShipping", () => {
	it("maps and trims Stripe shipping details for LumaPrints", () => {
		const recipient = buildRecipientFromShipping({
			name: " Jane Doe ",
			address: {
				line1: " 123 Main St ",
				line2: " Apt 4 ",
				city: " Portland ",
				state: " OR ",
				postal_code: " 97201 ",
				country: " US ",
			},
		} as any);

		expect(recipient).toEqual({
			firstName: "Jane",
			lastName: "Doe",
			address1: "123 Main St",
			address2: "Apt 4",
			city: "Portland",
			state: "OR",
			zip: "97201",
			country: "US",
		});
	});

	it("throws a permanent validation error before submitting incomplete shipping to LumaPrints", () => {
		expect(() =>
			buildRecipientFromShipping({
				name: "Jane Doe",
				address: {
					line1: "123 Main St",
					city: "Portland",
					state: "OR",
					postal_code: "",
					country: "US",
				},
			} as any),
		).toThrow(FulfillmentValidationError);
	});
});
