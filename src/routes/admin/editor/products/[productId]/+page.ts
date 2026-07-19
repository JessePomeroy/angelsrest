import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params }) => ({ productId: params.productId });
