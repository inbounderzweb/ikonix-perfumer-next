"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { confirmMobileChange, requestMobileChange, updateProfileAction } from "@/app/actions/customer/account";
import type { ProfileDTO } from "@/server/customer/profile";
import { useToast } from "./toast";
import { btnGhost, btnPrimary, field } from "./ui";

const L = ({ id, label, hint, err, children }: { id: string; label: string; hint?: string; err?: string; children: React.ReactNode }) => (
  <div><label htmlFor={id} className="mb-1 block font-fancy text-sm text-[#53443D]">{label}</label>{children}{hint && !err && <p className="mt-1 text-xs text-[#6b5446]">{hint}</p>}{err && <p role="alert" className="mt-1 text-xs text-red-600">{err}</p>}</div>
);

export function ProfileForm({ p }: { p: ProfileDTO }) {
  const toast = useToast(); const router = useRouter(); const [pending, start] = useTransition();
  const [f, setF] = useState({ name: p.name, alternativePhone: p.alternativePhone.replace(/^\+91/, ""), dateOfBirth: p.dateOfBirth, gender: p.gender });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [avatar, setAvatar] = useState(p.avatarUrl); const [up, setUp] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const save = (e: React.FormEvent) => {
    e.preventDefault(); setErrs({});
    if (f.name.trim().length < 2) return setErrs({ name: "Enter your full name" });
    start(async () => {
      const r = await updateProfileAction({ ...f, gender: f.gender as never });
      if (r.ok) { toast("ok", r.message ?? "Saved"); router.refresh(); } else { setErrs(r.fields ?? {}); toast("err", r.error); }
    });
  };
  async function upload(file: File) {
    setUp(true);
    try {
      if (!/^image\/(jpeg|png|webp|avif|gif)$/.test(file.type)) throw new Error("Choose a JPG, PNG, WEBP, AVIF or GIF image.");
      if (file.size > 10 * 1024 * 1024) throw new Error("Image must be under 10 MB.");
      const fd = new FormData(); fd.set("file", file);
      const r = await fetch("/api/account/avatar", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Upload failed");
      setAvatar(j.url); toast("ok", "Profile photo updated."); router.refresh();
    } catch (e) { toast("err", e instanceof Error ? e.message : "Upload failed"); } finally { setUp(false); }
  }
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="relative grid h-20 w-20 place-items-center overflow-hidden rounded-full bg-[#b49d91] font-heading text-3xl text-white">{avatar ? <Image src={avatar} alt="Profile photo" fill sizes="80px" className="object-cover" /> : (p.name[0] ?? "U").toUpperCase()}</div>
        <div className="space-x-2">
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" hidden onChange={(e) => { const x = e.target.files?.[0]; if (x) void upload(x); e.target.value = ""; }} />
          <button type="button" className={btnGhost} disabled={up} onClick={() => file.current?.click()}>{up ? "Uploading…" : avatar ? "Change photo" : "Upload photo"}</button>
          {avatar && <button type="button" className={btnGhost} onClick={async () => { await fetch("/api/account/avatar", { method: "DELETE" }); setAvatar(""); router.refresh(); toast("ok", "Photo removed."); }}>Remove</button>}
        </div>
      </div>
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
        <L id="name" label="Full name" err={errs.name}><input id="name" className={field} value={f.name} onChange={set("name")} maxLength={80} required /></L>
        <L id="email" label="Email" hint={p.googleEmail ? "Verified by Google. Cannot be changed." : "Cannot be changed here."}><input id="email" className={field} value={p.email || "Not provided"} disabled readOnly /></L>
        <L id="alt" label="Alternative contact (optional)" err={errs.alternativePhone} hint="Used only if we can't reach your main number."><input id="alt" className={field} inputMode="numeric" value={f.alternativePhone} onChange={set("alternativePhone")} placeholder="10-digit mobile" maxLength={14} /></L>
        <L id="dob" label="Date of birth" err={errs.dateOfBirth}><input id="dob" type="date" className={field} value={f.dateOfBirth} onChange={set("dateOfBirth")} max={new Date().toISOString().slice(0, 10)} /></L>
        <L id="gender" label="Gender" err={errs.gender}><select id="gender" className={field} value={f.gender} onChange={set("gender")}><option value="">Prefer not to say</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option></select></L>
        <div className="sm:col-span-2"><button className={btnPrimary} disabled={pending}>{pending ? "Saving…" : "Save changes"}</button></div>
      </form>
      <MobileSection current={p.mobile} verified={p.mobileVerified} />
    </div>
  );
}

function MobileSection({ current, verified }: { current: string; verified: boolean }) {
  const toast = useToast(); const router = useRouter(); const [pending, start] = useTransition();
  const [mobile, setMobile] = useState(""); const [sent, setSent] = useState<{ mock: boolean } | null>(null); const [code, setCode] = useState("");
  return (
    <div className="rounded-2xl border border-[#e7dbd3] bg-white p-4">
      <h3 className="font-heading text-lg text-[#8C7367]">Mobile number</h3>
      <p className="font-fancy text-sm text-[#53443D]">{current ? <>{current} {verified ? <span className="text-green-700">✓ verified</span> : <span className="text-orange-700">not verified</span>}</> : "No mobile number yet. Add and verify one for order updates."}</p>
      {!sent ? (
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await requestMobileChange(mobile); if (r.ok) { setSent({ mock: r.mock }); toast("ok", r.message); } else toast("err", r.error); }); }}>
          <input aria-label="New mobile number" className={`${field} max-w-xs`} inputMode="numeric" placeholder="New 10-digit mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} />
          <button className={btnGhost} disabled={pending || !mobile}>{current ? "Change number" : "Add number"} — send code</button>
        </form>
      ) : (
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await confirmMobileChange(mobile, code); if (r.ok) { toast("ok", r.message ?? "Updated"); setSent(null); setMobile(""); setCode(""); router.refresh(); } else toast("err", r.error); }); }}>
          <input aria-label="Verification code" className={`${field} max-w-[11rem] text-center tracking-widest`} inputMode="numeric" maxLength={6} placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          <button className={btnPrimary} disabled={pending || code.length !== 6}>Verify</button>
          <button type="button" className={btnGhost} onClick={() => setSent(null)}>Cancel</button>
          {sent.mock && <p className="w-full text-xs text-amber-800">Development mode: no SMS is sent.</p>}
        </form>
      )}
    </div>
  );
}
