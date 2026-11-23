import type { Metadata } from "next";
import { requireCustomerPage } from "@/server/auth/customer-session";
import { listAddresses } from "@/server/customer/addresses";
import { AddressManager } from "@/components/account/address-manager";

export const metadata: Metadata = { title: "My Addresses", robots: { index: false } };

export default async function AddressesPage() {
  const me = await requireCustomerPage("/account/addresses");
  const addresses = await listAddresses(me.id);
  return (
    <div className="space-y-5">
      <h1 className="font-heading text-[28px] text-[#8C7367]">Saved addresses</h1>
      <AddressManager initial={addresses} defaultName={me.name} defaultPhone={me.mobile} />
    </div>
  );
}
