import { getAdminConfig, type AdminConfig } from "@jessepomeroy/admin";
import {
	createAdminMutationHandler,
	getServerConfig,
	type AdminServerConfig,
} from "@jessepomeroy/admin/server";
import { api as rootApi } from "@jessepomeroy/crm-api";
import { api } from "@jessepomeroy/crm-api/api";
import type { Doc, Id } from "@jessepomeroy/crm-api/dataModel";
import type { MutationCtx, QueryCtx } from "@jessepomeroy/crm-api/server";
import type { FunctionArgs } from "convex/server";

const browserConfig: AdminConfig = getAdminConfig();
const serverConfig: AdminServerConfig = getServerConfig();
const ids = [] as Id<"orders">[];
const documents = [] as Doc<"orders">[];
const contexts = [] as Array<MutationCtx | QueryCtx>;
const clearClientArgs: Pick<FunctionArgs<typeof api.crm.updateClient>, "clearFields"> = {
	clearFields: ["email", "phone", "type", "source", "notes", "siteUrl_client"],
};

void [
	browserConfig,
	serverConfig,
	createAdminMutationHandler,
	rootApi,
	api,
	ids,
	documents,
	contexts,
	clearClientArgs,
];
