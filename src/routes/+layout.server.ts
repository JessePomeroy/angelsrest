export function load({ locals }) {
	return {
		isPreview: locals.isPreview ?? false,
	};
}
