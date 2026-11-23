"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/actions/admin/auth";
import { Field, Notice, button, inputCls } from "@/components/admin/ui";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-4" noValidate>
      {state?.error && <Notice tone="danger">{state.error}</Notice>}
      <Field label="Email" htmlFor="email"><input id="email" name="email" type="email" autoComplete="username" required className={inputCls} /></Field>
      <Field label="Password" htmlFor="password"><input id="password" name="password" type="password" autoComplete="current-password" required className={inputCls} /></Field>
      <button type="submit" disabled={pending} className={button("primary", "w-full")}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
