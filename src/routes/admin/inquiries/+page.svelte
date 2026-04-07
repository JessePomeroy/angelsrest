<script lang="ts">
import { formatDateTime } from "../utils";

let { data } = $props();

// svelte-ignore state_referenced_locally
let inquiries = $state(data.inquiries);
let selectedInquiry = $state<any>(null);
let statusFilter = $state("all");

const statusOptions = ["all", "new", "read", "replied"];

let filteredInquiries = $derived(
	statusFilter === "all"
		? inquiries
		: inquiries.filter((inq: any) => inq.status === statusFilter),
);

function getStatusColor(status: string): string {
	const colors: Record<string, string> = {
		new: "var(--status-slate)",
		read: "var(--status-amber)",
		replied: "var(--status-sage)",
	};
	return colors[status] || "var(--status-slate)";
}

function truncate(text: string, len = 60): string {
	if (!text) return "\u2014";
	return text.length > len ? `${text.slice(0, len)}...` : text;
}

function openInquiry(inq: any) {
	selectedInquiry = inq;
}

function closeModal() {
	selectedInquiry = null;
}

async function updateStatus(id: string, newStatus: string) {
	// Optimistic update
	const idx = inquiries.findIndex((inq: any) => inq._id === id);
	if (idx !== -1) {
		inquiries[idx] = { ...inquiries[idx], status: newStatus };
		inquiries = [...inquiries];
	}
	if (selectedInquiry?._id === id) {
		selectedInquiry = { ...selectedInquiry, status: newStatus };
	}

	try {
		const response = await fetch(`/api/admin/inquiries/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: newStatus }),
		});
		if (!response.ok) {
			// Revert on failure
			if (idx !== -1) {
				inquiries[idx] = {
					...inquiries[idx],
					status:
						data.inquiries.find((inq: any) => inq._id === id)?.status || "new",
				};
				inquiries = [...inquiries];
			}
			console.error("Failed to update inquiry status");
		}
	} catch (err) {
		console.error("Failed to update inquiry status:", err);
	}
}

function replyViaEmail(email: string, subject: string) {
	const mailtoSubject = subject ? `Re: ${subject}` : "";
	window.open(
		`mailto:${email}?subject=${encodeURIComponent(mailtoSubject)}`,
		"_blank",
	);
}
</script>

<div class="inquiries-page">
	<header class="page-header">
		<h1>inquiries</h1>
	</header>

	<div class="toolbar">
		<select class="filter-select" bind:value={statusFilter}>
			{#each statusOptions as status}
				<option value={status}>
					{status === "all" ? "all statuses" : status}
				</option>
			{/each}
		</select>
		<span class="count">{filteredInquiries.length} inquiries</span>
	</div>

	{#if filteredInquiries.length === 0}
		<div class="empty-state">no inquiries found</div>
	{:else}
		<div class="table-wrap">
			<table class="inquiries-table">
				<thead>
					<tr>
						<th>date</th>
						<th>name</th>
						<th>email</th>
						<th>subject</th>
						<th>preview</th>
						<th>status</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each filteredInquiries as inq (inq._id)}
						<tr class:unread={inq.status === "new"}>
							<td class="nowrap">{formatDateTime(inq.submittedAt)}</td>
							<td>{inq.name || "\u2014"}</td>
							<td class="email-cell">{inq.email || "\u2014"}</td>
							<td>{inq.subject || "\u2014"}</td>
							<td class="preview-cell">{truncate(inq.message)}</td>
							<td>
								<span class="status-indicator">
									<span class="status-dot" style="background: {getStatusColor(inq.status)}"></span>
									{inq.status || "new"}
								</span>
							</td>
							<td>
								<button class="view-btn" onclick={() => openInquiry(inq)}>view</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<!-- Detail modal -->
{#if selectedInquiry}
	<div
		class="modal-overlay"
		role="dialog"
		tabindex="-1"
		aria-modal="true"
		aria-label="Inquiry details"
		onclick={closeModal}
		onkeydown={(e) => { if (e.key === "Escape") closeModal(); }}
	>
		<div class="modal-content" role="presentation" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<div>
					<h2>{selectedInquiry.subject || "no subject"}</h2>
					<p class="modal-meta">
						from <strong>{selectedInquiry.name || "unknown"}</strong>
						&middot; {formatDateTime(selectedInquiry.submittedAt)}
					</p>
				</div>
				<button class="close-btn" onclick={closeModal}>&#10005;</button>
			</div>

			<div class="modal-details">
				<div class="detail-row">
					<span class="detail-label">email</span>
					<span>{selectedInquiry.email || "\u2014"}</span>
				</div>
				{#if selectedInquiry.phone}
					<div class="detail-row">
						<span class="detail-label">phone</span>
						<span>{selectedInquiry.phone}</span>
					</div>
				{/if}
				<div class="detail-row">
					<span class="detail-label">status</span>
					<span class="status-indicator">
						<span class="status-dot" style="background: {getStatusColor(selectedInquiry.status)}"></span>
						{selectedInquiry.status || "new"}
					</span>
				</div>
			</div>

			<div class="message-body">
				<h3>message</h3>
				<p>{selectedInquiry.message || "No message content."}</p>
			</div>

			<div class="modal-actions">
				{#if selectedInquiry.status !== "read"}
					<button class="action-btn" onclick={() => updateStatus(selectedInquiry._id, "read")}>
						mark read
					</button>
				{/if}
				{#if selectedInquiry.status !== "replied"}
					<button class="action-btn" onclick={() => updateStatus(selectedInquiry._id, "replied")}>
						mark replied
					</button>
				{/if}
				{#if selectedInquiry.email}
					<button
						class="action-btn primary"
						onclick={() => replyViaEmail(selectedInquiry.email, selectedInquiry.subject)}
					>
						reply via email
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.inquiries-page {
		padding: 48px 40px;
		max-width: 1100px;
	}

	.page-header {
		margin-bottom: 32px;
	}

	.page-header h1 {
		font-family: "Chillax", sans-serif;
		font-size: 1.8rem;
		font-weight: 500;
		color: var(--admin-heading);
		margin: 0;
		letter-spacing: -0.01em;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-bottom: 24px;
	}

	.filter-select {
		padding: 7px 12px;
		background: transparent;
		border: 1px solid var(--admin-border-strong);
		border-radius: 6px;
		color: var(--admin-text);
		font-size: 0.83rem;
		font-family: "Synonym", system-ui, sans-serif;
	}

	.count {
		font-size: 0.8rem;
		color: var(--admin-text-subtle);
	}

	.table-wrap {
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
	}

	.inquiries-table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		font-size: 0.85rem;
	}

	.inquiries-table th {
		color: var(--admin-text-subtle);
		font-weight: 400;
		font-size: 0.75rem;
		letter-spacing: 0.04em;
		padding: 0 16px 12px 0;
		border-bottom: 1px solid var(--admin-border);
	}

	.inquiries-table td {
		padding: 14px 16px 14px 0;
		border-bottom: 1px solid var(--admin-border);
		color: var(--admin-text);
	}

	.inquiries-table tbody tr:hover {
		background: var(--admin-active);
	}

	.inquiries-table tbody tr.unread td {
		color: var(--admin-heading);
		font-weight: 500;
	}

	.nowrap {
		white-space: nowrap;
	}

	.email-cell {
		font-size: 0.82rem;
		color: var(--admin-text-muted);
	}

	.preview-cell {
		color: var(--admin-text-muted);
		max-width: 250px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.status-indicator {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.8rem;
		color: var(--admin-text-muted);
	}

	.status-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.view-btn {
		padding: 4px 12px;
		background: transparent;
		border: 1px solid var(--admin-border-strong);
		border-radius: 5px;
		color: var(--admin-text-muted);
		font-size: 0.76rem;
		font-family: "Synonym", system-ui, sans-serif;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}

	.view-btn:hover {
		color: var(--admin-accent-hover);
		border-color: var(--admin-accent);
	}

	.empty-state {
		padding: 48px 0;
		color: var(--admin-text-subtle);
		font-size: 0.88rem;
	}

	/* Modal */
	.modal-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(8px);
		padding: 16px;
	}

	.modal-content {
		background: var(--admin-bg, #1e293b);
		border: 1px solid var(--admin-border);
		border-radius: 12px;
		width: 100%;
		max-width: 540px;
		max-height: 85vh;
		overflow-y: auto;
		padding: 32px;
		box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 24px;
	}

	.modal-header h2 {
		font-family: "Chillax", sans-serif;
		font-size: 1.15rem;
		font-weight: 500;
		color: var(--admin-heading);
		margin: 0 0 4px;
	}

	.modal-meta {
		font-size: 0.8rem;
		color: var(--admin-text-muted);
		margin: 0;
	}

	.close-btn {
		background: none;
		border: none;
		color: var(--admin-text-subtle);
		font-size: 1rem;
		cursor: pointer;
		padding: 4px;
		line-height: 1;
		transition: color 0.15s;
	}

	.close-btn:hover {
		color: var(--admin-heading);
	}

	.modal-details {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-bottom: 24px;
		padding-bottom: 20px;
		border-bottom: 1px solid var(--admin-border);
	}

	.detail-row {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 0.85rem;
	}

	.detail-label {
		color: var(--admin-text-subtle);
		min-width: 50px;
		font-size: 0.78rem;
	}

	.message-body {
		margin-bottom: 28px;
	}

	.message-body h3 {
		font-size: 0.78rem;
		font-weight: 400;
		color: var(--admin-text-subtle);
		letter-spacing: 0.04em;
		margin: 0 0 10px;
	}

	.message-body p {
		font-size: 0.9rem;
		line-height: 1.7;
		color: var(--admin-text);
		white-space: pre-wrap;
		margin: 0;
	}

	.modal-actions {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}

	.action-btn {
		padding: 7px 16px;
		border-radius: 6px;
		font-size: 0.8rem;
		font-family: "Synonym", system-ui, sans-serif;
		cursor: pointer;
		border: 1px solid var(--admin-border-strong);
		background: transparent;
		color: var(--admin-text);
		transition: color 0.15s, border-color 0.15s;
	}

	.action-btn:hover {
		color: var(--admin-heading);
		border-color: var(--admin-text-muted);
	}

	.action-btn.primary {
		background: rgba(129, 140, 248, 0.12);
		border-color: rgba(129, 140, 248, 0.25);
		color: var(--admin-accent-hover);
	}

	.action-btn.primary:hover {
		background: rgba(129, 140, 248, 0.18);
	}

	@media (max-width: 768px) {
		.inquiries-page {
			padding: 20px 16px;
		}

		.toolbar {
			flex-direction: column;
			align-items: flex-start;
			gap: 8px;
		}

		.modal-content {
			max-width: 100%;
			margin: 0;
			border-radius: 12px 12px 0 0;
			padding: 24px 20px;
		}

		.modal-overlay {
			align-items: flex-end;
			padding: 0;
		}

		.modal-actions {
			flex-direction: column;
		}

		.modal-actions .action-btn {
			width: 100%;
			text-align: center;
		}
	}
</style>
