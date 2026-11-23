import { cookies } from "next/headers";
import { AdminShell, type NavItem } from "@/components/admin/shell";
import { requireAdminPage } from "@/server/auth/guard";
import type { Permission } from "@/server/auth/permissions";
import { THEME_COOKIE, parseTheme } from "@/lib/admin-theme";

const NAV: (NavItem & { perm: Permission })[] = [
  { href: "/admin", label: "Dashboard", icon: "home", exact: true, perm: "dashboard.view" },
  { href: "/admin/products", label: "Products", icon: "box", perm: "products.read" },
  { href: "/admin/media", label: "Media library", icon: "image", perm: "media.read" },
  { href: "/admin/orders", label: "Orders", icon: "cart", perm: "orders.read" },
  { href: "/admin/delivery", label: "Delivery", icon: "truck", perm: "delivery.read" },
  { href: "/admin/customers", label: "Customers", icon: "users", perm: "customers.read" },
  { href: "/admin/staff", label: "Staff & roles", icon: "shield", perm: "staff.manage" },
  { href: "/admin/audit", label: "Audit log", icon: "log", perm: "audit.read" },
  { href: "/admin/profile", label: "My profile", icon: "users", perm: "dashboard.view" },
];

export default async function PanelLayout({ children }: LayoutProps<"/admin">) {
  const admin = await requireAdminPage();
  const nav = NAV.filter((n) => admin.permissions.has(n.perm)).map((n) => ({ href: n.href, label: n.label, icon: n.icon, exact: n.exact }));
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <AdminShell nav={nav} user={{ name: admin.name, email: admin.email, roles: admin.roleKeys }} initialTheme={theme}>
      {children}
    </AdminShell>
  );
}
