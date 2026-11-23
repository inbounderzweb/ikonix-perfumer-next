"use client";

import { useActionState, useRef, useState } from "react";
import { loginAction } from "@/app/actions/admin/auth";

type Errors = { email?: string; password?: string };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(email: string, password: string): Errors {
  const e: Errors = {};
  if (!email.trim()) e.email = "Email is required.";
  else if (!EMAIL_RE.test(email.trim())) e.email = "Enter a valid email address.";
  if (!password) e.password = "Password is required.";
  return e;
}

const fieldCls = (invalid: boolean) =>
  `peer w-full rounded-xl border bg-a-surface py-3 pl-11 text-[15px] text-a-fg placeholder:text-a-muted/60 transition focus:outline-none focus:ring-4 disabled:opacity-60 ${
    invalid ? "border-a-danger focus:border-a-danger focus:ring-a-danger/15" : "border-a-border hover:border-a-muted/50 focus:border-a-accent focus:ring-a-accent/15"
  }`;

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [touched, setTouched] = useState<{ email?: boolean; password?: boolean }>({});
  const [submitted, setSubmitted] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const errors = validate(email, password);
  const showErr = (k: keyof Errors) => (submitted || touched[k]) && errors[k];

  return (
    <form
      action={action}
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        setSubmitted(true);
        const errs = validate(email, password);
        if (errs.email || errs.password) {
          e.preventDefault();
          (errs.email ? emailRef : passwordRef).current?.focus();
        }
      }}
    >
      {state?.error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-a-danger/30 bg-a-danger/10 px-3.5 py-3 text-sm text-a-danger">
          <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden><path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" /></svg>
          <span>{state.error}</span>
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-sm font-medium text-a-fg">Email address <span className="text-a-danger" aria-hidden>*</span></label>
        <div className="relative">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="pointer-events-none absolute top-1/2 left-3.5 h-5 w-5 -translate-y-1/2 text-a-muted" aria-hidden>
            <rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <input
            ref={emailRef} id="email" name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false}
            required aria-required="true" aria-invalid={!!showErr("email")} aria-describedby={showErr("email") ? "email-error" : undefined}
            placeholder="you@ikonixperfumer.com" value={email} disabled={pending}
            onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            className={`${fieldCls(!!showErr("email"))} pr-4`}
          />
        </div>
        {showErr("email") && <p id="email-error" className="text-xs text-a-danger">{errors.email}</p>}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-sm font-medium text-a-fg">Password <span className="text-a-danger" aria-hidden>*</span></label>
        <div className="relative">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="pointer-events-none absolute top-1/2 left-3.5 h-5 w-5 -translate-y-1/2 text-a-muted" aria-hidden>
            <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" strokeLinecap="round" />
          </svg>
          <input
            ref={passwordRef} id="password" name="password" type={show ? "text" : "password"} autoComplete="current-password"
            required aria-required="true" aria-invalid={!!showErr("password")} aria-describedby={[showErr("password") ? "password-error" : "", caps ? "caps-hint" : ""].filter(Boolean).join(" ") || undefined}
            placeholder="Enter your password" value={password} disabled={pending}
            onChange={(e) => setPassword(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            onKeyUp={(e) => setCaps(e.getModifierState("CapsLock"))} onKeyDown={(e) => setCaps(e.getModifierState("CapsLock"))}
            className={`${fieldCls(!!showErr("password"))} pr-12`}
          />
          <button
            type="button" onClick={() => setShow((s) => !s)} disabled={pending}
            aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} aria-controls="password"
            className="absolute top-1/2 right-2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-a-muted transition hover:bg-a-raised hover:text-a-fg focus-visible:outline-2 focus-visible:outline-a-accent"
          >
            {show ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5" aria-hidden><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.4 5.2A9.8 9.8 0 0 1 12 5c5 0 8.5 4.2 9.5 7-.4 1.1-1.2 2.5-2.4 3.8M6.2 6.7C4.4 8 3.1 9.9 2.5 12c1 2.8 4.5 7 9.5 7 1.7 0 3.2-.5 4.5-1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5" aria-hidden><path d="M2.5 12C3.5 9.2 7 5 12 5s8.5 4.2 9.5 7c-1 2.8-4.5 7-9.5 7s-8.5-4.2-9.5-7Z" strokeLinejoin="round" /><circle cx="12" cy="12" r="3" /></svg>
            )}
          </button>
        </div>
        {showErr("password") && <p id="password-error" className="text-xs text-a-danger">{errors.password}</p>}
        {caps && <p id="caps-hint" className="flex items-center gap-1 text-xs text-a-warn">Caps Lock is on</p>}
      </div>

      <button
        type="submit" disabled={pending}
        className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-a-accent px-4 py-3.5 text-[15px] font-semibold text-a-accent-fg shadow-lg shadow-a-accent/20 transition hover:-translate-y-px hover:shadow-xl hover:shadow-a-accent/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-a-accent active:translate-y-0 disabled:cursor-wait disabled:opacity-80"
      >
        {pending ? (
          <>
            <svg viewBox="0 0 24 24" className="h-5 w-5 animate-spin" fill="none" aria-hidden><circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
            Signing in…
          </>
        ) : (
          <>
            Sign in
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden><path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.64l-3.22-3.22a.75.75 0 1 1 1.06-1.06l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 1 1-1.06-1.06l3.22-3.22H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd" /></svg>
          </>
        )}
      </button>
    </form>
  );
}
