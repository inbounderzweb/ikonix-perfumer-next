import type { Metadata } from "next";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/lib/admin-theme";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Ikonix Admin" }, robots: { index: false, follow: false } };


export default async function AdminRootLayout({ children }: LayoutProps<"/admin">) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div className="admin-root min-h-screen bg-a-bg text-a-fg" data-theme={theme}>
      {children}
    </div>
  );
}
