"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { reorderAction } from "@/app/actions/customer/account";
import { useCart } from "@/components/store/cart-context";
import { useToast } from "./toast";
import { btnPrimary } from "./ui";

export function ReorderButton({ orderNumber }: { orderNumber: string }) {
  const cart = useCart(); const toast = useToast(); const router = useRouter(); const [pending, start] = useTransition();
  return (
    <button className={btnPrimary} disabled={pending} onClick={() => start(async () => {
      const r = await reorderAction(orderNumber);
      if (!r.ok) return toast("err", r.error);
      if (!r.lines.length) return toast("err", `Nothing can be reordered: ${r.skipped.map((s) => `${s.name} is ${s.reason}`).join("; ")}`);
      for (const l of r.lines) cart.add(l.variantId, l.qty);
      toast("ok", r.skipped.length ? `Added available items. Skipped: ${r.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}` : "Items added to your cart.");
      router.push("/checkout");
    })}>{pending ? "Checking availability…" : "Reorder"}</button>
  );
}
