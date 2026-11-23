import type { Metadata } from "next";
import { getCustomer } from "@/server/auth/customer-session";
import { listAddresses } from "@/server/customer/addresses";
import { CheckoutClient } from "./checkout-client";

export const metadata: Metadata = { title: "Checkout", robots: { index: false, follow: false } };

export default async function CheckoutPage() {
  const me = await getCustomer();
  const addresses = me ? await listAddresses(me.id) : [];
  return <CheckoutClient customer={me ? { name: me.name, email: me.email, mobile: me.mobile } : null} addresses={addresses} />;
}
