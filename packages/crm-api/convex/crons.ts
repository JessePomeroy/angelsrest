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
export default crons;
