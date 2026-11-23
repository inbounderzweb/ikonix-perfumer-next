import type { ReactNode } from "react";
import { requireCustomerPage } from "@/server/auth/customer-session";
import { ToastProvider } from "@/components/account/toast";
import { AccountNav } from "@/components/account/nav";

export default async function AccountLayout({ children }: LayoutProps<"/account">) {
  const me = await requireCustomerPage("/account");
  return (
    <ToastProvider>
      <div className="mx-auto w-[92%] max-w-6xl py-6 lg:py-10">
        <div className="grid gap-6 lg:grid-cols-[230px_1fr]">
          <AccountNav name={me.name || "Your account"} sub={me.email || me.mobile} avatar={me.avatarUrl} />
          <div className="min-w-0">{children as ReactNode}</div>
        </div>
      </div>
    </ToastProvider>
  );
}
