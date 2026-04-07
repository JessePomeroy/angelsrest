/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as contracts from "../contracts.js";
import type * as crm from "../crm.js";
import type * as emailTemplates from "../emailTemplates.js";
import type * as invoices from "../invoices.js";
import type * as kanban from "../kanban.js";
import type * as messages from "../messages.js";
import type * as orders from "../orders.js";
import type * as platform from "../platform.js";
import type * as quotes from "../quotes.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  contracts: typeof contracts;
  crm: typeof crm;
  emailTemplates: typeof emailTemplates;
  invoices: typeof invoices;
  kanban: typeof kanban;
  messages: typeof messages;
  orders: typeof orders;
  platform: typeof platform;
  quotes: typeof quotes;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
