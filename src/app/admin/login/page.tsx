import { redirect } from "next/navigation";
import { getAdmin } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await getAdmin()) redirect("/admin");
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-a-border bg-a-surface p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-a-accent text-sm font-bold text-a-accent-fg">IK</span>
          <div><h1 className="text-lg font-semibold">Ikonix Admin</h1><p className="text-xs text-a-muted">Staff sign-in</p></div>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
