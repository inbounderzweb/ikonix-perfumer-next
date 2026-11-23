// Seeds the 5 staff roles and creates (or resets) a staff login.
// Usage: npx tsx scripts/ikonix/create-admin.ts <email> [ROLE_KEY=SUPER_ADMIN] [--reset]
// A strong random password is generated and printed ONCE; it is stored only as a bcrypt hash.
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { connect, disconnect } from "./_env";
import { Role, User } from "../../src/server/models";
import { ROLES, ROLE_KEYS, type RoleKey } from "../../src/server/auth/permissions";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const reset = process.argv.includes("--reset");
  const email = args[0]?.trim().toLowerCase();
  const roleKey = (args[1] ?? "SUPER_ADMIN") as RoleKey;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Usage: create-admin <email> [ROLE_KEY] [--reset]");
  if (!ROLE_KEYS.includes(roleKey)) throw new Error(`Unknown role. One of: ${ROLE_KEYS.join(", ")}`);

  await connect();
  for (const key of ROLE_KEYS) {
    const r = ROLES[key];
    await Role.updateOne({ key }, { $set: { name: r.name, description: r.description, permissions: [...r.permissions], isSystem: true } }, { upsert: true });
  }
  console.log(`roles seeded: ${ROLE_KEYS.join(", ")}`);

  const existing = await User.findOne({ email }, "+passwordHash").lean() as { _id: unknown; passwordHash?: string; roleKeys: string[] } | null;
  if (existing?.passwordHash && !reset) {
    await User.updateOne({ _id: existing._id }, { $addToSet: { roleKeys: roleKey } });
    console.log(`${email} already has a login; role ${roleKey} ensured. Use --reset to issue a new password.`);
    return;
  }
  const password = randomBytes(15).toString("base64url"); // 120 bits
  const passwordHash = await bcrypt.hash(password, 12);
  await User.updateOne(
    { email },
    { $set: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null, status: "ACTIVE", emailVerifiedAt: new Date(), name: existing ? undefined : "Administrator" }, $addToSet: { roleKeys: roleKey } },
    { upsert: true },
  );
  console.log(`\nStaff login ready for ${email} (${roleKey}).\nOne-time password: ${password}\nSign in at /admin/login and change it from Admin → Profile.`);
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(disconnect);
