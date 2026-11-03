import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
const crons = cronJobs();
crons.interval(
	"prepare business record search",
	{ hours: 1 },
	internal.businessRecords.ensureSearch,
	{},
);
crons.interval(
	"recover due recurring drafts",
	{ hours: 1 },
	internal.recurringInvoices.recoverDue,
	{},
);
crons.interval("recover Gmail synchronization and sends", { minutes: 1 }, internal.gmailState.maintain, {});
crons.interval("enforce Gmail pilot retention", { minutes: 1 }, internal.gmailState.retain, {});
crons.interval("remove abandoned private Gmail uploads", { hours: 24 }, internal.gmailState.cleanUploadOrphans, {});
export default crons;
