import { deliveryData } from "./data";
export const draftPreviewData = new URLSearchParams(window.location.search).has("draftPreview") ? {
 draftPreview: { kind: "settings" as const, siteSettings: deliveryData.siteSettings, editorHref: "/admin/editor" },
} : {};
