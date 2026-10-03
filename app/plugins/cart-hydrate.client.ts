import { useCartStore } from '~/stores/cart';

// Load the cart on boot so the header count is right after a full reload; never blocks the app.
export default defineNuxtPlugin(() => {
  const cartStore = useCartStore();
  if (!cartStore.cartId) return;
  void cartStore.loadCart().catch(() => {});
});
