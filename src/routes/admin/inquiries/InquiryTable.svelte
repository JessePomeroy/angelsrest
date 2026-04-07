<script lang="ts">
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
	inquiries: Inquiry[];
	onview: (inquiry: Inquiry) => void;
}

let { inquiries, onview }: Props = $props();

function truncate(text: string, len = 60): string {
	if (!text) return "\u2014";
	return text.length > len ? `${text.slice(0, len)}...` : text;
}
</script>

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
			{#each inquiries as inq (inq._id)}
				<tr class:unread={inq.status === "new"}>
					<td class="nowrap">{formatDateTime(inq.submittedAt)}</td>
					<td>{inq.name || "\u2014"}</td>
					<td class="email-cell">{inq.email || "\u2014"}</td>
					<td>{inq.subject || "\u2014"}</td>
					<td class="preview-cell">{truncate(inq.message ?? "")}</td>
					<td>
						<StatusDot color={getStatusColor(INQUIRY_STATUS_COLORS, inq.status)} label={inq.status || "new"} />
					</td>
					<td>
						<button class="view-btn" onclick={() => onview(inq)}>view</button>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
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
</style>
