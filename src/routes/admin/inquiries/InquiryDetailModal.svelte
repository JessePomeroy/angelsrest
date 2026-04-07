<script lang="ts">
import AdminModal from "$lib/admin/components/AdminModal.svelte";
import StatusDot from "$lib/admin/components/StatusDot.svelte";
import type { InquiryStatus } from "$lib/admin/types";
import {
	formatDateTime,
	getStatusColor,
	INQUIRY_STATUS_COLORS,
} from "$lib/admin/utils";

interface Inquiry {
	_id: string;
	name: string | null;
	email: string | null;
	phone?: string;
	subject: string | null;
	message: string | null;
	status: InquiryStatus;
	submittedAt: string;
}

interface Props {
	inquiry: Inquiry;
	onclose: () => void;
	onupdatestatus: (id: string, status: InquiryStatus) => void;
}

let { inquiry, onclose, onupdatestatus }: Props = $props();

function replyViaEmail(email: string, subject: string) {
	const mailtoSubject = subject ? `Re: ${subject}` : "";
	window.open(
		`mailto:${email}?subject=${encodeURIComponent(mailtoSubject)}`,
		"_blank",
	);
}
</script>

<AdminModal title={inquiry.subject || "no subject"} {onclose}>
	<div class="modal-body">
		<p class="modal-meta">
			from <strong>{inquiry.name || "unknown"}</strong>
			&middot; {formatDateTime(inquiry.submittedAt)}
		</p>

		<div class="modal-details">
			<div class="detail-row">
				<span class="detail-label">email</span>
				<span>{inquiry.email || "\u2014"}</span>
			</div>
			{#if inquiry.phone}
				<div class="detail-row">
					<span class="detail-label">phone</span>
					<span>{inquiry.phone}</span>
				</div>
			{/if}
			<div class="detail-row">
				<span class="detail-label">status</span>
				<StatusDot color={getStatusColor(INQUIRY_STATUS_COLORS, inquiry.status)} label={inquiry.status || "new"} />
			</div>
		</div>

		<div class="message-body">
			<h3>message</h3>
			<p>{inquiry.message || "No message content."}</p>
		</div>

		<div class="modal-actions">
			{#if inquiry.status !== "read"}
				<button class="action-btn" onclick={() => onupdatestatus(inquiry._id, "read")}>
					mark read
				</button>
			{/if}
			{#if inquiry.status !== "replied"}
				<button class="action-btn" onclick={() => onupdatestatus(inquiry._id, "replied")}>
					mark replied
				</button>
			{/if}
			{#if inquiry.email}
				<button
					class="action-btn primary"
					onclick={() => replyViaEmail(inquiry.email!, inquiry.subject ?? "")}
				>
					reply via email
				</button>
			{/if}
		</div>
	</div>
</AdminModal>

<style>
	.modal-body {
		padding: 0 28px 28px;
	}

	.modal-meta {
		font-size: 0.8rem;
		color: var(--admin-text-muted);
		margin: 0 0 24px;
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
		.modal-actions {
			flex-direction: column;
		}

		.modal-actions .action-btn {
			width: 100%;
			text-align: center;
		}
	}
</style>
