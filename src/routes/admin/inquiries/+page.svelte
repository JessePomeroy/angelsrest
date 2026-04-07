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
		<h1>Inquiries</h1>
		<p class="subtitle">Messages from your contact form</p>
	</header>

	<div class="toolbar">
		<select class="filter-select" bind:value={statusFilter}>
			{#each statusOptions as status}
				<option value={status}>
					{status === "all" ? "All Statuses" : status.charAt(0).toUpperCase() + status.slice(1)}
				</option>
			{/each}
		</select>
		<span class="count">{filteredInquiries.length} inquiries</span>
	</div>

	{#if filteredInquiries.length === 0}
		<div class="empty-state">No inquiries found</div>
	{:else}
		<div class="table-wrap">
			<table class="inquiries-table">
				<thead>
					<tr>
						<th>Date</th>
						<th>Name</th>
						<th>Email</th>
						<th>Subject</th>
						<th>Preview</th>
						<th>Status</th>
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
								<span class="status-badge" style="background: {getStatusColor(inq.status)}">
									{inq.status || "new"}
								</span>
							</td>
							<td>
								<button class="view-btn" onclick={() => openInquiry(inq)}>View</button>
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
					<h2>{selectedInquiry.subject || "No Subject"}</h2>
					<p class="modal-meta">
						From <strong>{selectedInquiry.name || "Unknown"}</strong>
						&middot; {formatDateTime(selectedInquiry.submittedAt)}
					</p>
				</div>
				<button class="close-btn" onclick={closeModal}>&#10005;</button>
			</div>

			<div class="modal-details">
				<div class="detail-row">
					<span class="detail-label">Email</span>
					<span>{selectedInquiry.email || "\u2014"}</span>
				</div>
				{#if selectedInquiry.phone}
					<div class="detail-row">
						<span class="detail-label">Phone</span>
						<span>{selectedInquiry.phone}</span>
					</div>
				{/if}
				<div class="detail-row">
					<span class="detail-label">Status</span>
					<span class="status-badge" style="background: {getStatusColor(selectedInquiry.status)}">
						{selectedInquiry.status || "new"}
					</span>
				</div>
			</div>

			<div class="message-body">
				<h3>Message</h3>
				<p>{selectedInquiry.message || "No message content."}</p>
			</div>

			<div class="modal-actions">
				{#if selectedInquiry.status !== "read"}
					<button class="action-btn" onclick={() => updateStatus(selectedInquiry._id, "read")}>
						Mark Read
					</button>
				{/if}
				{#if selectedInquiry.status !== "replied"}
					<button class="action-btn" onclick={() => updateStatus(selectedInquiry._id, "replied")}>
						Mark Replied
					</button>
				{/if}
				{#if selectedInquiry.email}
					<button
						class="action-btn primary"
						onclick={() => replyViaEmail(selectedInquiry.email, selectedInquiry.subject)}
					>
						Reply via Email
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.inquiries-page {
		padding: 32px;
		max-width: 1100px;
	}

	.page-header {
		margin-bottom: 24px;
	}

	.page-header h1 {
		font-size: 1.6rem;
		font-weight: 600;
		color: var(--admin-heading);
		margin: 0 0 4px;
	}

	.subtitle {
		color: var(--admin-text-muted);
		font-size: 0.9rem;
		margin: 0;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-bottom: 20px;
	}

	.filter-select {
		padding: 8px 12px;
		background: var(--admin-surface);
		border: 1px solid var(--admin-border-strong);
		border-radius: 6px;
		color: var(--admin-text);
		font-size: 0.85rem;
	}

	.count {
		font-size: 0.82rem;
		color: var(--admin-text-subtle);
	}

	.table-wrap {
		overflow-x: auto;
		background: var(--admin-surface);
		border: 1px solid var(--admin-border);
		border-radius: 8px;
	}

	.inquiries-table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		font-size: 0.85rem;
	}

	.inquiries-table th {
		color: var(--admin-text-subtle);
		font-weight: 500;
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 10px 12px;
		border-bottom: 1px solid var(--admin-border-strong);
	}

	.inquiries-table td {
		padding: 10px 12px;
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

	.status-badge {
		display: inline-block;
		padding: 3px 10px;
		border-radius: 12px;
		font-size: 0.75rem;
		font-weight: 500;
		color: #fff;
		text-transform: capitalize;
	}

	.view-btn {
		padding: 5px 14px;
		background: var(--admin-surface-raised);
		border: 1px solid var(--admin-border-strong);
		border-radius: 5px;
		color: var(--admin-text-muted);
		font-size: 0.78rem;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}

	.view-btn:hover {
		color: var(--admin-accent-hover);
		border-color: var(--admin-accent);
	}

	.empty-state {
		text-align: center;
		padding: 48px;
		color: var(--admin-text-subtle);
		background: var(--admin-surface);
		border: 1px solid var(--admin-border);
		border-radius: 8px;
	}

	/* Modal */
	.modal-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.6);
		padding: 16px;
	}

	.modal-content {
		background: var(--admin-surface);
		border: 1px solid var(--admin-border-strong);
		border-radius: 10px;
		width: 100%;
		max-width: 560px;
		max-height: 85vh;
		overflow-y: auto;
		padding: 28px;
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 20px;
	}

	.modal-header h2 {
		font-size: 1.15rem;
		font-weight: 600;
		color: var(--admin-heading);
		margin: 0 0 4px;
	}

	.modal-meta {
		font-size: 0.82rem;
		color: var(--admin-text-muted);
		margin: 0;
	}

	.close-btn {
		background: none;
		border: none;
		color: var(--admin-text-subtle);
		font-size: 1.2rem;
		cursor: pointer;
		padding: 4px;
		line-height: 1;
	}

	.close-btn:hover {
		color: var(--admin-accent-hover);
	}

	.modal-details {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 20px;
		padding: 16px;
		background: var(--admin-surface-raised);
		border-radius: 6px;
	}

	.detail-row {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 0.85rem;
	}

	.detail-label {
		color: var(--admin-text-subtle);
		min-width: 60px;
	}

	.message-body {
		margin-bottom: 24px;
	}

	.message-body h3 {
		font-size: 0.82rem;
		font-weight: 500;
		color: var(--admin-text-subtle);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 8px;
	}

	.message-body p {
		font-size: 0.9rem;
		line-height: 1.6;
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
		padding: 8px 18px;
		border-radius: 6px;
		font-size: 0.82rem;
		cursor: pointer;
		border: 1px solid var(--admin-border-strong);
		background: var(--admin-surface-raised);
		color: var(--admin-text);
		transition: color 0.15s, border-color 0.15s;
	}

	.action-btn:hover {
		color: var(--admin-accent-hover);
		border-color: var(--admin-accent);
	}

	.action-btn.primary {
		background: rgba(255, 255, 255, 0.1);
		border-color: rgba(255, 255, 255, 0.2);
		color: var(--admin-heading);
	}

	.action-btn.primary:hover {
		background: rgba(255, 255, 255, 0.15);
	}

	@media (max-width: 768px) {
		.inquiries-page {
			padding: 20px 16px;
		}
	}
</style>
