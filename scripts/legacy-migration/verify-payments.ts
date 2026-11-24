// READ-ONLY Razorpay verification. Fetches each legacy payment id (GET /v1/payments/:id) and writes the actual captured
// amount/status to scripts/legacy-migration/reports/razorpay-actual.json for migrate.ts (--razorpay-data=...).
// It never captures, refunds or creates anything. Use LIVE keys of the account that took the payments:
//   RAZORPAY_VERIFY_KEY_ID=rzp_live_... RAZORPAY_VERIFY_KEY_SECRET=... npx tsx scripts/legacy-migration/verify-payments.ts
// (Separate variable names on purpose: the .env test keys cannot see live payments, and these are never stored.)
import fs from "node:fs";
import path from "node:path";
import { parseDump } from "./sql-parse";

const dump = process.argv.find((a) => a.startsWith("--dump="))?.slice(7) ?? path.join(process.env.HOME ?? "", "Downloads/ikonix.sql");
const id = process.env.RAZORPAY_VERIFY_KEY_ID; const secret = process.env.RAZORPAY_VERIFY_KEY_SECRET;
if (!id || !secret) { console.error("Set RAZORPAY_VERIFY_KEY_ID and RAZORPAY_VERIFY_KEY_SECRET (live keys). Nothing was sent."); process.exit(2); }
const auth = "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
const ids = parseDump(dump).paylog.filter((p) => p.paystatus === 1).map((p) => String(p.razid));
const out: { id: string; amountPaise: number; status: string }[] = []; const missing: { id: string; http: number }[] = [];

async function main() {
  for (const pid of ids) {
    const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(pid)}`, { headers: { Authorization: auth } });
    if (!res.ok) { missing.push({ id: pid, http: res.status }); continue; }
    const j = (await res.json()) as { id: string; amount: number; status: string; amount_refunded?: number };
    out.push({ id: j.id, amountPaise: j.amount, status: j.status });
  }
  const dir = path.join(process.cwd(), "scripts/legacy-migration/reports"); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "razorpay-actual.json"), JSON.stringify(out, null, 1));
  console.log(`fetched ${out.length}/${ids.length}; not found/denied ${missing.length}`, missing.slice(0, 5));
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
