// Only the browser route state read by BottomNav is substituted.
export const page = $state({ url: new URL(window.location.href), state: {} });
export const navigating = $state<{ to: { url: URL } | null }>({ to: null });
