import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./authHelpers";

const DEFAULT_COLUMNS: Record<string, string[]> = {
	wedding: [
		"inquiry",
		"consultation",
		"booked",
		"planning",
		"shoot day",
		"editing",
		"delivery",
		"complete",
	],
	portrait: ["inquiry", "booked", "shoot", "editing", "delivery", "complete"],
	family: ["inquiry", "booked", "shoot", "editing", "delivery", "complete"],
	commercial: [
		"brief",
		"proposal",
		"booked",
		"production",
		"review",
		"delivery",
		"complete",
	],
	event: ["inquiry", "booked", "shoot", "editing", "delivery", "complete"],
	website: [
		"lead",
		"discovery",
		"proposal",
		"development",
		"review",
		"launch",
		"maintenance",
	],
	redesign: [
		"lead",
		"discovery",
		"proposal",
		"development",
		"review",
		"launch",
	],
	maintenance: ["request", "review", "in-progress", "testing", "complete"],
	other: ["lead", "booked", "in-progress", "completed"],
};

// Map existing CRM statuses to the closest default column name per project type
const STATUS_TO_COLUMN: Record<string, Record<string, string>> = {
	wedding: {
		lead: "inquiry",
		booked: "booked",
		"in-progress": "planning",
		completed: "complete",
		archived: "complete",
	},
	portrait: {
		lead: "inquiry",
		booked: "booked",
		"in-progress": "shoot",
		completed: "complete",
		archived: "complete",
	},
	family: {
		lead: "inquiry",
		booked: "booked",
		"in-progress": "shoot",
		completed: "complete",
		archived: "complete",
	},
	commercial: {
		lead: "brief",
		booked: "booked",
		"in-progress": "production",
		completed: "complete",
		archived: "complete",
	},
	event: {
		lead: "inquiry",
		booked: "booked",
		"in-progress": "shoot",
		completed: "complete",
		archived: "complete",
	},
	website: {
		lead: "lead",
		booked: "development",
		"in-progress": "development",
		completed: "launch",
		archived: "launch",
	},
	redesign: {
		lead: "lead",
		booked: "development",
		"in-progress": "development",
		completed: "launch",
		archived: "launch",
	},
	maintenance: {
		lead: "request",
		booked: "review",
		"in-progress": "in-progress",
		completed: "complete",
		archived: "complete",
	},
	other: {
		lead: "lead",
		booked: "booked",
		"in-progress": "in-progress",
		completed: "completed",
		archived: "completed",
	},
};

function generateId(): string {
	return Math.random().toString(36).slice(2, 11);
}

// Queries

export const getBoardConfig = query({
	args: { siteUrl: v.string(), projectType: v.string() },
	handler: async (ctx, { siteUrl, projectType }) => {
		return await ctx.db
			.query("boardConfigs")
			.withIndex("by_siteUrl_and_projectType", (q) =>
				q.eq("siteUrl", siteUrl).eq("projectType", projectType),
			)
			.first();
	},
});

export const listBoardConfigs = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		return await ctx.db
			.query("boardConfigs")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.take(50);
	},
});

// Mutations

export const initializeBoard = mutation({
	args: { siteUrl: v.string(), projectType: v.string() },
	handler: async (ctx, { siteUrl, projectType }) => {
		await requireAuth(ctx);
		// Check if board already exists
		const existing = await ctx.db
			.query("boardConfigs")
			.withIndex("by_siteUrl_and_projectType", (q) =>
				q.eq("siteUrl", siteUrl).eq("projectType", projectType),
			)
			.first();
		if (existing) return existing._id;

		// Create columns from defaults
		const columnNames = DEFAULT_COLUMNS[projectType] || DEFAULT_COLUMNS.other;
		const columns = columnNames.map((name, i) => ({
			id: generateId(),
			name,
			position: i,
		}));

		const configId = await ctx.db.insert("boardConfigs", {
			siteUrl,
			projectType,
			columns,
		});

		// Assign existing clients of this type to columns
		const statusMap = STATUS_TO_COLUMN[projectType] || STATUS_TO_COLUMN.other;
		const clients = await ctx.db
			.query("photographyClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.take(1000);

		const matchingClients = clients.filter((c) => c.type === projectType);
		// Track position counters per column
		const positionCounters: Record<string, number> = {};

		for (const client of matchingClients) {
			const targetColumnName = statusMap[client.status] || columnNames[0];
			const targetColumn = columns.find((c) => c.name === targetColumnName);
			if (targetColumn) {
				const pos = positionCounters[targetColumn.id] || 0;
				positionCounters[targetColumn.id] = pos + 1;
				await ctx.db.patch(client._id, {
					boardColumnId: targetColumn.id,
					boardPosition: pos,
				});
			}
		}

		return configId;
	},
});

export const moveCard = mutation({
	args: {
		clientId: v.id("photographyClients"),
		siteUrl: v.string(),
		targetColumnId: v.string(),
		targetPosition: v.number(),
	},
	handler: async (
		ctx,
		{ clientId, siteUrl, targetColumnId, targetPosition },
	) => {
		await requireAuth(ctx);
		const doc = await ctx.db.get(clientId);
		if (!doc || doc.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}
		await ctx.db.patch(clientId, {
			boardColumnId: targetColumnId,
			boardPosition: targetPosition,
		});
	},
});

export const addColumn = mutation({
	args: {
		configId: v.id("boardConfigs"),
		siteUrl: v.string(),
		name: v.string(),
	},
	handler: async (ctx, { configId, siteUrl, name }) => {
		await requireAuth(ctx);
		const config = await ctx.db.get(configId);
		if (!config || config.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}

		const newColumn = {
			id: generateId(),
			name,
			position: config.columns.length,
		};

		await ctx.db.patch(configId, {
			columns: [...config.columns, newColumn],
		});

		return newColumn.id;
	},
});

export const renameColumn = mutation({
	args: {
		configId: v.id("boardConfigs"),
		siteUrl: v.string(),
		columnId: v.string(),
		name: v.string(),
	},
	handler: async (ctx, { configId, siteUrl, columnId, name }) => {
		await requireAuth(ctx);
		const config = await ctx.db.get(configId);
		if (!config || config.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}

		await ctx.db.patch(configId, {
			columns: config.columns.map((col) =>
				col.id === columnId ? { ...col, name } : col,
			),
		});
	},
});

export const deleteColumn = mutation({
	args: {
		configId: v.id("boardConfigs"),
		siteUrl: v.string(),
		columnId: v.string(),
		moveToColumnId: v.optional(v.string()),
	},
	handler: async (ctx, { configId, siteUrl, columnId, moveToColumnId }) => {
		await requireAuth(ctx);
		const config = await ctx.db.get(configId);
		if (!config || config.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}

		// Move clients from deleted column to target column (or first remaining)
		const remainingColumns = config.columns.filter((c) => c.id !== columnId);
		const fallbackColumnId = moveToColumnId || remainingColumns[0]?.id || null;

		if (fallbackColumnId) {
			const clients = await ctx.db
				.query("photographyClients")
				.withIndex("by_siteUrl_and_boardColumnId", (q) =>
					q.eq("siteUrl", config.siteUrl).eq("boardColumnId", columnId),
				)
				.take(500);

			for (const client of clients) {
				await ctx.db.patch(client._id, {
					boardColumnId: fallbackColumnId,
					boardPosition: client.boardPosition ?? 0,
				});
			}
		}

		// Reindex positions
		const updatedColumns = remainingColumns.map((col, i) => ({
			...col,
			position: i,
		}));

		await ctx.db.patch(configId, { columns: updatedColumns });
	},
});

export const reorderColumns = mutation({
	args: {
		configId: v.id("boardConfigs"),
		siteUrl: v.string(),
		columnIds: v.array(v.string()),
	},
	handler: async (ctx, { configId, siteUrl, columnIds }) => {
		await requireAuth(ctx);
		const config = await ctx.db.get(configId);
		if (!config || config.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}

		const columnMap = new Map(config.columns.map((c) => [c.id, c]));
		const reordered = columnIds
			.map((id, i) => {
				const col = columnMap.get(id);
				if (!col) return null;
				return { ...col, position: i };
			})
			.filter((c): c is NonNullable<typeof c> => c !== null);

		await ctx.db.patch(configId, { columns: reordered });
	},
});
