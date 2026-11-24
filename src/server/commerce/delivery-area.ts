import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { Setting } from "@/server/models";
import { AREA_MODES, DEFAULT_AREA, parsePincodes, validStates, type DeliveryArea } from "@/lib/delivery-area";

export const AREA_KEY = "delivery.area";
const stored = z.object({ mode: z.enum(AREA_MODES), states: z.array(z.string()).default([]), pincodes: z.array(z.string()).default([]), message: z.string().default("") });

/** The saved delivery area; a missing or unreadable setting means "all over India" (the previous behaviour). */
export async function getDeliveryArea(): Promise<DeliveryArea> {
  await db();
  const row = (await Setting.findById(AREA_KEY).lean()) as unknown as { value?: unknown } | null;
  const p = stored.safeParse(row?.value);
  return p.success ? { ...p.data, states: validStates(p.data.states), pincodes: parsePincodes(p.data.pincodes.join(" ")) } : DEFAULT_AREA;
}
