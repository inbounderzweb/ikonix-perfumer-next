"use server";

import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/lib/admin-theme";

export async function setThemeAction(theme: string) {
  (await cookies()).set(THEME_COOKIE, parseTheme(theme), { path: "/admin", maxAge: 365 * 24 * 3600, sameSite: "lax", httpOnly: false });
}
