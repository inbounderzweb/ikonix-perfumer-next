import { z } from "zod";
import { COUNTRIES, normalizeMobile } from "@/lib/phone";
import { INDIAN_STATES } from "@/lib/india";

const mobile = z.string().trim().transform((s, ctx) => {
  const n = normalizeMobile(s);
  if (!n) ctx.addIssue({ code: "custom", message: "Enter a valid mobile number" });
  return n ?? "";
});
const optionalMobile = z.union([z.literal(""), mobile]).transform((v) => v || undefined);

export const profileInput = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(80),
  alternativePhone: optionalMobile.optional(),
  dateOfBirth: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")]).optional()
    .refine((v) => { if (!v) return true; const d = new Date(`${v}T00:00:00Z`); const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000); return !Number.isNaN(d.getTime()) && age >= 13 && age <= 120; }, "Enter a valid date of birth (13+ years)"),
  gender: z.enum(["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY", ""]).optional(),
}).strict(); // .strict(): an `email` (or any other) field is rejected, so email can never be edited from the profile

export const addressInput = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/).optional(),
  type: z.enum(["HOME", "WORK", "OTHER"]),
  fullName: z.string().trim().min(2, "Enter the recipient's name").max(80),
  phone: mobile,
  line1: z.string().trim().min(3, "Enter the address").max(150),
  line2: z.string().trim().max(150).default(""),
  landmark: z.string().trim().max(100).default(""),
  city: z.string().trim().min(2, "Enter the city").max(80),
  state: z.string().trim().min(2, "Select the state").max(80),
  country: z.string().trim().toUpperCase().default("IN"),
  postalCode: z.string().trim().min(3).max(12),
  makeDefault: z.boolean().default(false),
}).superRefine((a, ctx) => {
  const c = COUNTRIES[a.country];
  if (!c) return ctx.addIssue({ code: "custom", path: ["country"], message: "We currently deliver within India only" });
  if (!c.postal.test(a.postalCode)) ctx.addIssue({ code: "custom", path: ["postalCode"], message: `Enter a valid ${c.postalHint}` });
  if (a.country === "IN" && !(INDIAN_STATES as readonly string[]).includes(a.state)) ctx.addIssue({ code: "custom", path: ["state"], message: "Select a valid state" });
});
export type AddressInput = z.input<typeof addressInput>;

export const objectId = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
export const fieldErrors = (e: z.ZodError) => { const f: Record<string, string> = {}; for (const i of e.issues) f[i.path.join(".")] ??= i.message; return f; };
