import "server-only";
import { NextResponse } from "next/server";
import { ForbiddenError } from "./guard";

/** Wraps a Route Handler body: maps auth failures to 401/403 and hides internals from the client. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Response) return e;
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("route error:", e instanceof Error ? e.stack : e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
