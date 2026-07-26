import { error } from "@sveltejs/kit";
import type Stripe from "stripe";
import { api } from "$convex/api";
import { client } from "$lib/sanity/client";
import { issuePaidFile, resolvePaidDownload } from "$lib/server/catalogCommerceClients";
import { isCheckoutSessionOwner } from "$lib/server/checkoutBinding";
import { getConvex } from "$lib/server/convexClient";
import { getStripe } from "$lib/server/stripeClient";
import { getWebhookSecret } from "$lib/server/webhookSecret";

const exactSanity = client.withConfig({ useCdn: false, perspective: "published" });
const EXACT_PAID_FILE_QUERY = `*[_id == $id && _rev == $rev && _type == "product" && category == "digital"][0]{
  _id, _rev, "fileUrl": digitalFile.asset->url
}`;
const LEGACY_PAID_FILE_QUERY = `*[_type == "product" && slug.current == $slug][0]{
			"fileUrl": digitalFile.asset->url,
			title
		}`;

function canonicalSnapshot<T extends { items: readonly object[] }>(snapshot: T) {
	return {
		...snapshot,
		items: snapshot.items.map((item) => {
			const options = item as Record<string, unknown>;
			return {
				...item,
				materialOptionKey:
					options.materialOptionKey === undefined ? null : options.materialOptionKey,
				sizeOptionKey: options.sizeOptionKey === undefined ? null : options.sizeOptionKey,
				borderOptionKey: options.borderOptionKey === undefined ? null : options.borderOptionKey,
				frameOptionKey: options.frameOptionKey === undefined ? null : options.frameOptionKey,
			};
		}),
	};
}

function ordinal(value: string | null) {
	const parsed = value === null ? 0 : Number(value);
	if (
		!Number.isSafeInteger(parsed) ||
		parsed < 0 ||
		parsed >= 40 ||
		(value !== null && String(parsed) !== value)
	) {
		throw error(400, "Invalid item ordinal");
	}
	return parsed;
}

async function streamSanityFile(fileUrl: string, filename: string) {
	const response = await fetch(fileUrl);
	if (!response.ok || !response.body) throw error(500, "Failed to retrieve file");
	const contentLength = response.headers.get("Content-Length");
	return new Response(response.body, {
		headers: {
			"Content-Type": response.headers.get("Content-Type") ?? "application/zip",
			"Content-Disposition": `attachment; filename="${filename}.zip"`,
			"Cache-Control": "no-store",
			"Referrer-Policy": "no-referrer",
			...(contentLength ? { "Content-Length": contentLength } : {}),
		},
	});
}

export async function GET({ url, cookies }) {
	const sessionId = url.searchParams.get("session_id");
	if (!sessionId) throw error(400, "Missing session_id");

	let session: Stripe.Checkout.Session;
	try {
		session = await getStripe().checkout.sessions.retrieve(sessionId);
	} catch {
		throw error(400, "Invalid session");
	}
	if (session.payment_status !== "paid") throw error(403, "Payment not completed");

	const emailParam = url.searchParams.get("email")?.toLowerCase();
	if (!isCheckoutSessionOwner(cookies, sessionId)) {
		const sessionEmail = session.customer_details?.email?.toLowerCase();
		if (!emailParam || !sessionEmail || emailParam !== sessionEmail) {
			throw error(403, "Access denied");
		}
	}

	const itemIndex = ordinal(url.searchParams.get("item"));
	const convex = getConvex();
	const authority = await convex.query(api.orders.resolvePaidDownloadOrder, {
		stripeSessionId: sessionId,
		webhookSecret: getWebhookSecret(),
	});
	if (!authority || authority.refunded) throw error(409, "Download is not ready");
	const snapshot = authority.checkoutSnapshot
		? canonicalSnapshot(authority.checkoutSnapshot)
		: undefined;

	if (snapshot) {
		const item = snapshot.items[itemIndex];
		if (!item || item.productKind !== "digital_download") throw error(404, "Download not found");
		if (snapshot.catalogProvider === "convex") {
			const resolution = await resolvePaidDownload(sessionId, itemIndex);
			if (
				JSON.stringify(resolution.item) !== JSON.stringify(item) ||
				resolution.identity.productKind !== "digital_download" ||
				resolution.descriptor.kind !== "paid_zip"
			)
				throw error(404, "Download not found");
			const location = await issuePaidFile(resolution.descriptor);
			const race = await convex.query(api.orders.resolvePaidDownloadOrder, {
				stripeSessionId: sessionId,
				webhookSecret: getWebhookSecret(),
			});
			if (
				!race ||
				race.refunded ||
				!race.checkoutSnapshot ||
				JSON.stringify(canonicalSnapshot(race.checkoutSnapshot)) !== JSON.stringify(snapshot)
			) {
				throw error(409, "Download is not ready");
			}
			return new Response(null, {
				status: 303,
				headers: {
					Location: location,
					"Cache-Control": "no-store",
					"Referrer-Policy": "no-referrer",
				},
			});
		}
		const product = await exactSanity.fetch<{
			_id?: string;
			_rev?: string;
			fileUrl?: string;
		} | null>(EXACT_PAID_FILE_QUERY, { id: item.productKey, rev: item.revisionId });
		if (
			!product?.fileUrl ||
			product._id !== item.productKey ||
			product._rev !== item.revisionId ||
			item.variantKey !== null ||
			item.materialOptionKey !== null ||
			item.sizeOptionKey !== null ||
			item.borderOptionKey !== null ||
			item.frameOptionKey !== null
		)
			throw error(404, "Download not found");
		const race = await convex.query(api.orders.resolvePaidDownloadOrder, {
			stripeSessionId: sessionId,
			webhookSecret: getWebhookSecret(),
		});
		if (
			!race ||
			race.refunded ||
			!race.checkoutSnapshot ||
			JSON.stringify(canonicalSnapshot(race.checkoutSnapshot)) !== JSON.stringify(snapshot)
		) {
			throw error(409, "Download is not ready");
		}
		return streamSanityFile(product.fileUrl, `download-${itemIndex + 1}`);
	}

	const slug = url.searchParams.get("slug");
	if (!slug) throw error(400, "Missing slug");
	if (session.metadata?.productSlug !== slug) throw error(403, "Session does not match product");
	if (session.metadata?.isDigital !== "true")
		throw error(400, "This product is not a digital download");
	const product = await client.fetch<{ fileUrl?: string } | null>(LEGACY_PAID_FILE_QUERY, { slug });
	if (!product?.fileUrl) throw error(404, "Digital file not found");
	return streamSanityFile(product.fileUrl, slug);
}
