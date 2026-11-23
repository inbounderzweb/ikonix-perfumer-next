"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** While payment is being confirmed (webhook may lag), re-fetch the order every 4s for up to 2 minutes. */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => { if (++n > 30) clearInterval(t); else router.refresh(); }, 4000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}
