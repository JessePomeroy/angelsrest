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
import type * as blogContent from "../blogContent.js";
import type * as catalogProductGraphs from "../catalogProductGraphs.js";
import type * as catalogProducts from "../catalogProducts.js";
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
import type * as helpers_blogContentData from "../helpers/blogContentData.js";
import type * as helpers_blogContentQueries from "../helpers/blogContentQueries.js";
import type * as helpers_blogContentStore from "../helpers/blogContentStore.js";
import type * as helpers_blogContentValidationSupport from "../helpers/blogContentValidationSupport.js";
import type * as helpers_blogContentValidators from "../helpers/blogContentValidators.js";
import type * as helpers_catalogPrivateAssetValidators from "../helpers/catalogPrivateAssetValidators.js";
import type * as helpers_catalogProductData from "../helpers/catalogProductData.js";
import type * as helpers_catalogProductGraphAssets from "../helpers/catalogProductGraphAssets.js";
import type * as helpers_catalogProductGraphChecksum from "../helpers/catalogProductGraphChecksum.js";
import type * as helpers_catalogProductGraphData from "../helpers/catalogProductGraphData.js";
import type * as helpers_catalogProductGraphStore from "../helpers/catalogProductGraphStore.js";
import type * as helpers_catalogProductGraphValidators from "../helpers/catalogProductGraphValidators.js";
import type * as helpers_catalogProductStore from "../helpers/catalogProductStore.js";
import type * as helpers_catalogProductValidators from "../helpers/catalogProductValidators.js";
import type * as helpers_contactPageValidators from "../helpers/contactPageValidators.js";
import type * as helpers_contentLifecycle from "../helpers/contentLifecycle.js";
import type * as helpers_contentSlugHistory from "../helpers/contentSlugHistory.js";
import type * as helpers_contentStore from "../helpers/contentStore.js";
import type * as helpers_contentValidators from "../helpers/contentValidators.js";
import type * as helpers_deleting from "../helpers/deleting.js";
import type * as helpers_documentNumbering from "../helpers/documentNumbering.js";
import type * as helpers_limits from "../helpers/limits.js";
import type * as helpers_marking from "../helpers/marking.js";
import type * as helpers_mediaValidators from "../helpers/mediaValidators.js";
import type * as helpers_modelingPageData from "../helpers/modelingPageData.js";
import type * as helpers_modelingPageValidators from "../helpers/modelingPageValidators.js";
import type * as helpers_numbering from "../helpers/numbering.js";
import type * as helpers_orderStats from "../helpers/orderStats.js";
import type * as helpers_patching from "../helpers/patching.js";
import type * as helpers_portableTextAdapter from "../helpers/portableTextAdapter.js";
import type * as helpers_portableTextSpanAdapter from "../helpers/portableTextSpanAdapter.js";
import type * as helpers_portfolioData from "../helpers/portfolioData.js";
import type * as helpers_portfolioValidators from "../helpers/portfolioValidators.js";
import type * as helpers_postContentGraph from "../helpers/postContentGraph.js";
import type * as helpers_postContentIntegrity from "../helpers/postContentIntegrity.js";
import type * as helpers_postContentProjection from "../helpers/postContentProjection.js";
import type * as helpers_postContentQueries from "../helpers/postContentQueries.js";
import type * as helpers_postContentStore from "../helpers/postContentStore.js";
import type * as helpers_postContentValidationSupport from "../helpers/postContentValidationSupport.js";
import type * as helpers_postContentValidators from "../helpers/postContentValidators.js";
import type * as helpers_querying from "../helpers/querying.js";
import type * as helpers_richTextContract from "../helpers/richTextContract.js";
import type * as helpers_richTextNodeValidation from "../helpers/richTextNodeValidation.js";
import type * as helpers_richTextValidation from "../helpers/richTextValidation.js";
import type * as helpers_richTextValidationSupport from "../helpers/richTextValidationSupport.js";
import type * as helpers_sanityBlogImport from "../helpers/sanityBlogImport.js";
import type * as helpers_sanityBlogImportPlan from "../helpers/sanityBlogImportPlan.js";
import type * as helpers_sanityBlogImportStore from "../helpers/sanityBlogImportStore.js";
import type * as helpers_sanityCatalogImport from "../helpers/sanityCatalogImport.js";
import type * as helpers_sanityCatalogImportContract from "../helpers/sanityCatalogImportContract.js";
import type * as helpers_sanityCatalogImportProductAdapter from "../helpers/sanityCatalogImportProductAdapter.js";
import type * as helpers_sanityCatalogImportSupport from "../helpers/sanityCatalogImportSupport.js";
import type * as helpers_serverSecrets from "../helpers/serverSecrets.js";
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
import type * as postContent from "../postContent.js";
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
  blogContent: typeof blogContent;
  catalogProductGraphs: typeof catalogProductGraphs;
  catalogProducts: typeof catalogProducts;
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
  "helpers/blogContentData": typeof helpers_blogContentData;
  "helpers/blogContentQueries": typeof helpers_blogContentQueries;
  "helpers/blogContentStore": typeof helpers_blogContentStore;
  "helpers/blogContentValidationSupport": typeof helpers_blogContentValidationSupport;
  "helpers/blogContentValidators": typeof helpers_blogContentValidators;
  "helpers/catalogPrivateAssetValidators": typeof helpers_catalogPrivateAssetValidators;
  "helpers/catalogProductData": typeof helpers_catalogProductData;
  "helpers/catalogProductGraphAssets": typeof helpers_catalogProductGraphAssets;
  "helpers/catalogProductGraphChecksum": typeof helpers_catalogProductGraphChecksum;
  "helpers/catalogProductGraphData": typeof helpers_catalogProductGraphData;
  "helpers/catalogProductGraphStore": typeof helpers_catalogProductGraphStore;
  "helpers/catalogProductGraphValidators": typeof helpers_catalogProductGraphValidators;
  "helpers/catalogProductStore": typeof helpers_catalogProductStore;
  "helpers/catalogProductValidators": typeof helpers_catalogProductValidators;
  "helpers/contactPageValidators": typeof helpers_contactPageValidators;
  "helpers/contentLifecycle": typeof helpers_contentLifecycle;
  "helpers/contentSlugHistory": typeof helpers_contentSlugHistory;
  "helpers/contentStore": typeof helpers_contentStore;
  "helpers/contentValidators": typeof helpers_contentValidators;
  "helpers/deleting": typeof helpers_deleting;
  "helpers/documentNumbering": typeof helpers_documentNumbering;
  "helpers/limits": typeof helpers_limits;
  "helpers/marking": typeof helpers_marking;
  "helpers/mediaValidators": typeof helpers_mediaValidators;
  "helpers/modelingPageData": typeof helpers_modelingPageData;
  "helpers/modelingPageValidators": typeof helpers_modelingPageValidators;
  "helpers/numbering": typeof helpers_numbering;
  "helpers/orderStats": typeof helpers_orderStats;
  "helpers/patching": typeof helpers_patching;
  "helpers/portableTextAdapter": typeof helpers_portableTextAdapter;
  "helpers/portableTextSpanAdapter": typeof helpers_portableTextSpanAdapter;
  "helpers/portfolioData": typeof helpers_portfolioData;
  "helpers/portfolioValidators": typeof helpers_portfolioValidators;
  "helpers/postContentGraph": typeof helpers_postContentGraph;
  "helpers/postContentIntegrity": typeof helpers_postContentIntegrity;
  "helpers/postContentProjection": typeof helpers_postContentProjection;
  "helpers/postContentQueries": typeof helpers_postContentQueries;
  "helpers/postContentStore": typeof helpers_postContentStore;
  "helpers/postContentValidationSupport": typeof helpers_postContentValidationSupport;
  "helpers/postContentValidators": typeof helpers_postContentValidators;
  "helpers/querying": typeof helpers_querying;
  "helpers/richTextContract": typeof helpers_richTextContract;
  "helpers/richTextNodeValidation": typeof helpers_richTextNodeValidation;
  "helpers/richTextValidation": typeof helpers_richTextValidation;
  "helpers/richTextValidationSupport": typeof helpers_richTextValidationSupport;
  "helpers/sanityBlogImport": typeof helpers_sanityBlogImport;
  "helpers/sanityBlogImportPlan": typeof helpers_sanityBlogImportPlan;
  "helpers/sanityBlogImportStore": typeof helpers_sanityBlogImportStore;
  "helpers/sanityCatalogImport": typeof helpers_sanityCatalogImport;
  "helpers/sanityCatalogImportContract": typeof helpers_sanityCatalogImportContract;
  "helpers/sanityCatalogImportProductAdapter": typeof helpers_sanityCatalogImportProductAdapter;
  "helpers/sanityCatalogImportSupport": typeof helpers_sanityCatalogImportSupport;
  "helpers/serverSecrets": typeof helpers_serverSecrets;
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
  postContent: typeof postContent;
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
