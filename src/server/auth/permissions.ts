// Role → permission map for the 5 staff roles. Pure data (no server-only) so the admin UI can hide
// nav items; the SERVER re-checks every permission on every action (UI hiding is cosmetic).
export const PERMISSIONS = [
  "dashboard.view",
  "products.read", "products.write", "products.delete",
  "media.read", "media.write", "media.delete",
  "inventory.write",
  "orders.read", "orders.write", "orders.refund",
  "customers.read", "customers.write",
  "delivery.read", "delivery.write",
  "promotions.write",
  "staff.manage",
  "audit.read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = {
  SUPER_ADMIN: { name: "Super admin", description: "Full access, including staff and roles.", permissions: [...PERMISSIONS] as Permission[] },
  PRODUCT_MANAGER: {
    name: "Product manager", description: "Catalogue, media and stock.",
    permissions: ["dashboard.view", "products.read", "products.write", "products.delete", "media.read", "media.write", "media.delete", "inventory.write"] as Permission[],
  },
  ORDER_MANAGER: {
    name: "Order manager", description: "Orders, delivery and refunds.",
    permissions: ["dashboard.view", "orders.read", "orders.write", "orders.refund", "delivery.read", "delivery.write", "customers.read", "products.read"] as Permission[],
  },
  MARKETING_MANAGER: {
    name: "Marketing manager", description: "Offers and media.",
    permissions: ["dashboard.view", "products.read", "media.read", "media.write", "promotions.write"] as Permission[],
  },
  SUPPORT_STAFF: {
    name: "Support staff", description: "Read-only orders and customers.",
    permissions: ["dashboard.view", "orders.read", "customers.read", "products.read", "delivery.read"] as Permission[],
  },
} as const;
export type RoleKey = keyof typeof ROLES;
export const ROLE_KEYS = Object.keys(ROLES) as RoleKey[];

export function permissionsFor(roleKeys: readonly string[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const k of roleKeys) if (k in ROLES) for (const p of ROLES[k as RoleKey].permissions) out.add(p);
  return out;
}
