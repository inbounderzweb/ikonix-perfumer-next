// Prints Cloudinary plan usage (no secrets). Usage: npx tsx scripts/ikonix/cloudinary-usage.ts
import "./_env";
import { v2 as c } from "cloudinary";

c.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

c.api.usage().then((u) => {
  console.log(JSON.stringify({ plan: u.plan, storage: u.storage, resources: u.resources, transformations: u.transformations, credits: u.credits }, null, 1));
}).catch((e) => { console.error("usage failed:", e?.error?.message ?? e?.message ?? "unknown"); process.exit(1); });
