import { v } from "convex/values";

/** Shared category validator for photography vs web clients/documents. */
export const categoryValidator = v.union(
	v.literal("photography"),
	v.literal("web"),
);
