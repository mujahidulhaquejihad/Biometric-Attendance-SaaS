"use client";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { AuthShell, Button, Field, Input } from "@/components/ui";
import { signUp } from "./actions";

export default function SignUp() {
  const [state, action, pending] = useActionState(signUp, { error: "" });
  const [tz, setTz] = useState("UTC");
  useEffect(() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone), []);

  return (
    <AuthShell title="Create your organization">
      <form action={action} className="space-y-4">
        <Field label="Company name"><Input name="company" required /></Field>
        <Field label="Your name"><Input name="name" required autoComplete="name" /></Field>
        <Field label="Work email"><Input name="email" type="email" required autoComplete="email" /></Field>
        <Field label="Password" hint="At least 8 characters"><Input name="password" type="password" minLength={8} required autoComplete="new-password" /></Field>
        <Field label="Time zone"><Input name="timezone" value={tz} onChange={(e) => setTz(e.target.value)} required /></Field>
        {state.error && <p className="text-sm text-red-600" role="alert">{state.error}</p>}
        <Button className="w-full" disabled={pending}>{pending ? "Creating…" : "Create organization"}</Button>
      </form>
      <p className="mt-4 text-sm">
        Already have an account? <Link href="/login" className="text-blue-600 hover:underline">Sign in</Link>
      </p>
    </AuthShell>
  );
}
