<script lang="ts">
import StripeSetupPage from "../../../src/lib/components/StripeSetupPage.svelte";
import type { StripeConnectSetupData } from "../../../src/lib/stripeConnectSetup";
import { authClient } from "../handbook/auth";

const params = new URLSearchParams(window.location.search);
const phase = params.get("phase") ?? "new";
const sessionStatus: StripeConnectSetupData["sessionStatus"] = phase === "signed_out" || phase === "unauthorized" || phase === "unavailable" ? phase : "authorized";
const status = ["ready", "setup_required", "restricted", "pending_verification"].find(value => value === phase) as NonNullable<StripeConnectSetupData["readiness"]>["status"] | undefined;
const data: StripeConnectSetupData = {
  siteUrl: "studio.example.invalid", onboardingEnabled: phase !== "disabled", sessionStatus,
  email: phase === "signed_out" ? null : "studio@example.invalid",
  accountId: status || ["checking", "disconnected", "connection_unavailable"].includes(phase) ? "acct_fixture" : null,
  connectionIssue: phase === "checking" || phase === "disconnected" ? phase : phase === "connection_unavailable" ? "unavailable" : null,
  readiness: status ? { status, chargesEnabled: status === "ready" || status === "pending_verification", payoutsEnabled: status === "ready", detailsSubmitted: status !== "setup_required" } : null,
  message: sessionStatus === "unauthorized" ? "This login cannot manage payments for that website." : "We could not verify this payment connection. Please try again or contact Angels Rest.",
  returned: params.get("returned") === "1",
};
async function signOut() { throw new Error("Simulated sign-out failure"); }
</script>

<StripeSetupPage {data} form={phase === "expired" ? { message: "Your session expired. Sign in again to continue." } : null} {authClient} onSignOut={signOut} />
