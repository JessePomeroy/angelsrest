<script lang="ts">
import MobileNav from "../../../src/lib/components/MobileNav.svelte";
import CartDrawer from "../../../src/lib/components/cart/CartDrawer.svelte";
import { cart } from "../../../src/lib/shop/cart.svelte";
import { showCartAddition } from "../../../src/lib/shop/cartFeedback";
const photo = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="900"><rect width="400" height="900" fill="#dad6c5"/><circle cx="190" cy="690" r="130" fill="#375e60"/><path d="M0 850L400 200" stroke="#f9d178" stroke-width="50"/></svg>')}`;
function add(event: MouseEvent) {
	cart.add({ productSlug: "fixture", type: "print", title: "Fixture", imageUrl: photo, quantity: 1, unitPriceCents: 100 });
	showCartAddition(event.currentTarget);
}
</script>

<img data-water-lens src={photo} alt="Lens test photograph" style="position:fixed;inset:0;width:100%;height:100%;object-fit:cover" />
<button type="button" style="position:relative;z-index:1" onclick={add}>Add print</button>
<MobileNav />
<CartDrawer />
