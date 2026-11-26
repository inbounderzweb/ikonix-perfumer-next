// The central shipment tracking scheduler: one process for all shipments.
//   npm run tracking:worker            runs until stopped, checking every minute whether a synchronization is due
//   npm run tracking:worker -- --once  one check, then exit (for system cron)
// Running several copies is safe: a database lock lets only one of them work at a time.
import { disconnect } from "./_env";
import { db } from "../../src/server/db";
import { patchState } from "../../src/server/shipping/india-post/config";
import { runTrackingCycle } from "../../src/server/shipping/tracking/engine";

const TICK_MS = 60_000;
let stopping = false;
let wake: (() => void) | null = null;
for (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, () => { stopping = true; wake?.(); });
const log = (m: string) => console.log(`${new Date().toISOString()} [tracking] ${m}`);

async function main() {
  const once = process.argv.includes("--once");
  let last = "";
  log(once ? "single run" : "worker started");
  do {
    try {
      await db();
      await patchState({ workerSeenAt: new Date() });
      const r = await runTrackingCycle({ trigger: "SCHEDULED" });
      const line = r.ran ? `${r.status}: ${r.message} (new events ${r.newEvents})` : `${r.reason}: ${r.message}`;
      if (r.ran || line !== last) log(line); // don't repeat the same idle message every minute
      last = line;
    } catch (e) {
      log(`cycle error: ${e instanceof Error ? e.message : e}`);
      if (once) process.exitCode = 1;
    }
    if (!once && !stopping) await new Promise<void>((resolve) => { const t = setTimeout(resolve, TICK_MS); wake = () => { clearTimeout(t); resolve(); }; });
  } while (!once && !stopping);
  await disconnect();
  log("stopped");
}
void main();
