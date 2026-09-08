const scrollLocks = new WeakMap<Document, { count: number; overflow: string }>();

// Mount only while open. Native modality owns inertness; this action owns the
// matching teardown, including overlapping dialogs removed in either order.
export function openModal(node: HTMLDialogElement) {
	const document = node.ownerDocument;
	const opener = document.activeElement;
	node.showModal();
	const lock = scrollLocks.get(document) ?? {
		count: 0,
		overflow: document.body.style.overflow,
	};
	lock.count += 1;
	scrollLocks.set(document, lock);
	document.body.style.overflow = "hidden";
	return {
		destroy() {
			node.close();
			lock.count -= 1;
			if (lock.count === 0) {
				document.body.style.overflow = lock.overflow;
				scrollLocks.delete(document);
			}
			if (opener instanceof HTMLElement && opener.isConnected) {
				opener.focus({ preventScroll: true });
			}
		},
	};
}
