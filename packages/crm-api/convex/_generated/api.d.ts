/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activityLog from "../activityLog.js";
import type * as adminAuth from "../adminAuth.js";
import type * as auth from "../auth.js";
import type * as authHelpers from "../authHelpers.js";
import type * as content from "../content.js";
import type * as contracts from "../contracts.js";
import type * as crm from "../crm.js";
import type * as devPasswordReset from "../devPasswordReset.js";
import type * as emailLog from "../emailLog.js";
import type * as emailTemplates from "../emailTemplates.js";
import type * as galleries from "../galleries.js";
import type * as galleryAccess from "../galleryAccess.js";
import type * as galleryPassword from "../galleryPassword.js";
import type * as galleryPasswordStore from "../galleryPasswordStore.js";
import type * as helpers_aboutPageData from "../helpers/aboutPageData.js";
import type * as helpers_aboutPageValidators from "../helpers/aboutPageValidators.js";
import type * as helpers_contactPageValidators from "../helpers/contactPageValidators.js";
import type * as helpers_contentStore from "../helpers/contentStore.js";
import type * as helpers_contentValidators from "../helpers/contentValidators.js";
import type * as helpers_deleting from "../helpers/deleting.js";
import type * as helpers_documentNumbering from "../helpers/documentNumbering.js";
import type * as helpers_limits from "../helpers/limits.js";
import type * as helpers_marking from "../helpers/marking.js";
import type * as helpers_mediaValidators from "../helpers/mediaValidators.js";
import type * as helpers_numbering from "../helpers/numbering.js";
import type * as helpers_orderStats from "../helpers/orderStats.js";
import type * as helpers_patching from "../helpers/patching.js";
import type * as helpers_portfolioData from "../helpers/portfolioData.js";
import type * as helpers_portfolioValidators from "../helpers/portfolioValidators.js";
import type * as helpers_querying from "../helpers/querying.js";
import type * as helpers_stripeFeeCapture from "../helpers/stripeFeeCapture.js";
import type * as helpers_validators from "../helpers/validators.js";
import type * as http from "../http.js";
import type * as inquiries from "../inquiries.js";
import type * as invoices from "../invoices.js";
import type * as kanban from "../kanban.js";
import type * as mediaAssets from "../mediaAssets.js";
import type * as messages from "../messages.js";
import type * as notifications from "../notifications.js";
import type * as orders from "../orders.js";
import type * as platform from "../platform.js";
import type * as portal from "../portal.js";
import type * as portfolioGalleries from "../portfolioGalleries.js";
import type * as quotes from "../quotes.js";
import type * as stripeFees from "../stripeFees.js";
import type * as stripeFeesStore from "../stripeFeesStore.js";
import type * as tags from "../tags.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activityLog: typeof activityLog;
  adminAuth: typeof adminAuth;
  auth: typeof auth;
  authHelpers: typeof authHelpers;
  content: typeof content;
  contracts: typeof contracts;
  crm: typeof crm;
  devPasswordReset: typeof devPasswordReset;
  emailLog: typeof emailLog;
  emailTemplates: typeof emailTemplates;
  galleries: typeof galleries;
  galleryAccess: typeof galleryAccess;
  galleryPassword: typeof galleryPassword;
  galleryPasswordStore: typeof galleryPasswordStore;
  "helpers/aboutPageData": typeof helpers_aboutPageData;
  "helpers/aboutPageValidators": typeof helpers_aboutPageValidators;
  "helpers/contactPageValidators": typeof helpers_contactPageValidators;
  "helpers/contentStore": typeof helpers_contentStore;
  "helpers/contentValidators": typeof helpers_contentValidators;
  "helpers/deleting": typeof helpers_deleting;
  "helpers/documentNumbering": typeof helpers_documentNumbering;
  "helpers/limits": typeof helpers_limits;
  "helpers/marking": typeof helpers_marking;
  "helpers/mediaValidators": typeof helpers_mediaValidators;
  "helpers/numbering": typeof helpers_numbering;
  "helpers/orderStats": typeof helpers_orderStats;
  "helpers/patching": typeof helpers_patching;
  "helpers/portfolioData": typeof helpers_portfolioData;
  "helpers/portfolioValidators": typeof helpers_portfolioValidators;
  "helpers/querying": typeof helpers_querying;
  "helpers/stripeFeeCapture": typeof helpers_stripeFeeCapture;
  "helpers/validators": typeof helpers_validators;
  http: typeof http;
  inquiries: typeof inquiries;
  invoices: typeof invoices;
  kanban: typeof kanban;
  mediaAssets: typeof mediaAssets;
  messages: typeof messages;
  notifications: typeof notifications;
  orders: typeof orders;
  platform: typeof platform;
  portal: typeof portal;
  portfolioGalleries: typeof portfolioGalleries;
  quotes: typeof quotes;
  stripeFees: typeof stripeFees;
  stripeFeesStore: typeof stripeFeesStore;
  tags: typeof tags;
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

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
