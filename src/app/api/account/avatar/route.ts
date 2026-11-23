import { NextResponse } from "next/server";
import { handle } from "@/server/auth/http";
import { requireCustomer } from "@/server/auth/customer-session";
import { assertSameOrigin } from "@/server/auth/request";
import { rateLimit } from "@/server/auth/rate-limit";
import { db } from "@/server/db";
import { User } from "@/server/models";
import { storeImage, validateImage } from "@/server/media/cloudinary";
import { auditCustomer } from "@/server/customer/audit";

export const runtime = "nodejs";

export function POST(req: Request) {
  return handle(async () => {
    assertSameOrigin(req);
    const c = await requireCustomer();
    if (!(await rateLimit(`avatar:${c.id}`, 10, 3600))) return NextResponse.json({ error: "Too many uploads. Try again later." }, { status: 429 });
    const file = (await req.formData()).get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose an image." }, { status: 400 });
    const v = await validateImage(file); // content-sniffed type, size and pixel caps; SVG rejected
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    const { asset } = await storeImage(v, { folder: "avatars", filename: `avatar-${c.id}`, uploadedById: c.id });
    await db();
    await User.updateOne({ _id: c.id }, { avatarUrl: asset.url });
    await auditCustomer(c.id, "customer.avatar.update", "User", c.id);
    return NextResponse.json({ url: asset.url });
  });
}

export function DELETE(req: Request) {
  return handle(async () => {
    assertSameOrigin(req);
    const c = await requireCustomer();
    await db();
    await User.updateOne({ _id: c.id }, { $unset: { avatarUrl: 1 } });
    return NextResponse.json({ ok: true });
  });
}
