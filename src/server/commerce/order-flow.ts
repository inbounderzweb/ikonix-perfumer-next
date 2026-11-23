// Allowed manual status transitions (kept out of the "use server" action file, which may only export async functions).
const NEXT: Record<string, string[]> = {
  PENDING: ["CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["PACKED", "CANCELLED"],
  PACKED: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["OUT_FOR_DELIVERY", "DELIVERED", "DELIVERY_FAILED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "DELIVERY_FAILED"],
  DELIVERY_FAILED: ["OUT_FOR_DELIVERY", "DELIVERED"],
};
export const allowedNext = (status: string) => NEXT[status] ?? [];
