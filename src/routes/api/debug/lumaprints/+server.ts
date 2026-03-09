import { json } from "@sveltejs/kit";
import { getSubcategories } from "$lib/lumaprints/client";

// GET /api/debug/lumaprints/subcategories
export async function GET() {
	try {
		const subcategories = await getSubcategories(103); // Fine Art Paper category

		return json({
			categoryId: 103,
			categoryName: "Fine Art Paper",
			subcategories: subcategories.map((sc) => ({
				subcategoryId: sc.subcategoryId,
				name: sc.name,
				minWidth: sc.minimumWidth,
				maxWidth: sc.maximumWidth,
				minHeight: sc.minimumHeight,
				maxHeight: sc.maximumHeight,
				// Show common sizes within range
				commonSizes: [
					{ width: 4, height: 6, ratio: "2:3" },
					{ width: 5, height: 7, ratio: "5:7" },
					{ width: 8, height: 10, ratio: "4:5" },
					{ width: 8, height: 12, ratio: "2:3" },
					{ width: 11, height: 14, ratio: "11:14" },
					{ width: 11, height: 17, ratio: "11:17" },
					{ width: 16, height: 20, ratio: "4:5" },
					{ width: 16, height: 24, ratio: "2:3" },
				].filter(
					(s) =>
						s.width >= sc.minimumWidth &&
						s.width <= sc.maximumWidth &&
						s.height >= sc.minimumHeight &&
						s.height <= sc.maximumHeight,
				),
			})),
		});
	} catch (err) {
		return json({ error: err.message }, { status: 500 });
	}
}
