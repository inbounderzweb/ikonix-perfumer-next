import "server-only";
import { redirect } from "next/navigation";
import { getAdmin, type AdminUser } from "./session";
import type { Permission } from "./permissions";

export class ForbiddenError extends Error {
  constructor(public permission: Permission) { super(`Missing permission: ${permission}`); }
}

/** For pages/layouts: redirects to login when signed out, 403 page when the role lacks the permission. */
export async function requireAdminPage(permission?: Permission): Promise<AdminUser> {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  if (permission && !admin.permissions.has(permission)) redirect("/admin?denied=1");
  return admin;
}

/** For Server Actions / Route Handlers: throws instead of redirecting. */
export async function requireAdmin(permission: Permission): Promise<AdminUser> {
  const admin = await getAdmin();
  if (!admin) throw new Response("Unauthorized", { status: 401 });
  if (!admin.permissions.has(permission)) throw new ForbiddenError(permission);
  return admin;
}
