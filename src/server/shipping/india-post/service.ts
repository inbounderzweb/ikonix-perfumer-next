import "server-only";
import { isIP } from "node:net";
import { configProblems, connectionFingerprint, getConfig, patchState, writeConfig, type TrackingConfig } from "./config";
import { downloadBulkFile, parseLatestEventXml } from "./bulk-xml";
import { fetchArticleEvents } from "./article-api";
import { addDays, istDay } from "./dates";
import { asTrackingError } from "./errors";
import { checkConsignment } from "../../../lib/shipment-tracking";

export type TestResult = { ok: boolean; message: string };

/** The two integrations behind one interface: the tracking engine does not care which one is configured. */
export const IndiaPostTrackingService = {
  downloadBulkFile,
  parseLatestEventXml,
  fetchArticleEvents,

  /**
   * Live connection test against the saved settings. Only a pass allows tracking to be switched on, and only for
   * exactly these settings: it is how the Customer ID is validated instead of being assumed from a receipt.
   */
  async healthCheck(sampleTrackingNumber?: string): Promise<TestResult> {
    const c: TrackingConfig = await getConfig();
    const problems = configProblems(c);
    if (problems.length) return { ok: false, message: problems[0] };
    try {
      let message: string;
      if (c.mode === "BULK_XML") {
        const day = addDays(istDay(new Date()), -1);
        const xml = await downloadBulkFile(c, day);
        if (xml) message = `Connected. India Post returned a Latest Event file for ${day} with ${parseLatestEventXml(xml).records} record(s).`;
        else message = `India Post accepted the Customer ID; there is no file for ${day}. Check that records appear after your next booking.`;
      } else {
        const n = checkConsignment(sampleTrackingNumber ?? "");
        if (!n.ok) return { ok: false, message: "Enter a real consignment number booked on your account to test with." };
        const r = await fetchArticleEvents(c, n.value);
        if (!r.events.length) return { ok: false, message: "India Post answered, but no events were read for that number. Check the number and the response field mapping." };
        message = `Connected. Read ${r.events.length} event(s) for ${n.value}.`;
      }
      const latest = await getConfig();
      if (connectionFingerprint(latest) !== connectionFingerprint(c)) return { ok: false, message: "The settings changed during the test. Run it again." };
      await writeConfig({ ...latest, verifiedFingerprint: connectionFingerprint(c), verifiedAt: new Date() }, null);
      await patchState({ health: { status: "HEALTHY", message, checkedAt: new Date(), accessRejected: false }, backoffUntil: null, consecutiveFailures: 0 });
      return { ok: true, message };
    } catch (e) {
      const err = asTrackingError(e);
      await patchState({ health: { status: "DOWN", message: err.message, checkedAt: new Date(), accessRejected: err.kind === "AUTH" } });
      return { ok: false, message: err.message };
    }
  },

  /** The address India Post will see. Asks an echo service; nothing about the store is sent. */
  async outboundIp(): Promise<string> {
    const res = await fetch(process.env.INDIA_POST_IP_ECHO_URL || "https://api.ipify.org", { cache: "no-store", signal: AbortSignal.timeout(8000) });
    const ip = (await res.text()).trim();
    if (!res.ok || !isIP(ip)) throw new Error("The IP lookup service did not return an address.");
    await patchState({ outboundIp: ip, outboundIpAt: new Date() });
    return ip;
  },
};
