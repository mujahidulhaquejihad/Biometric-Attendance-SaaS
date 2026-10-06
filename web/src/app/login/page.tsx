"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell, Button, Field, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export default function Login() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [needs2fa, setNeeds2fa] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(fd: FormData) {
    setBusy(true);
    setError("");
    if (needs2fa) {
      const r = await authClient.twoFactor.verifyTotp({ code: String(fd.get("code")) });
      setBusy(false);
      if (r.error) return setError(r.error.message ?? "Invalid code");
      return router.push("/dashboard");
    }
    const r = await authClient.signIn.email({ email: String(fd.get("email")), password: String(fd.get("password")) });
    setBusy(false);
    if (r.error) return setError(r.error.message ?? "Sign-in failed");
    if ((r.data as { twoFactorRedirect?: boolean })?.twoFactorRedirect) return setNeeds2fa(true);
    router.push("/dashboard");
  }

  return (
    <AuthShell title="Sign in">
      <form action={onSubmit} className="space-y-4">
        {needs2fa ? (
          <Field label="Authenticator code">
            <Input name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus />
          </Field>
        ) : (
          <>
            <Field label="Email"><Input name="email" type="email" autoComplete="email" required /></Field>
            <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
          </>
        )}
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <Button className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <Link href="/forgot" className="text-blue-600 hover:underline">Forgot password?</Link>
        <Link href="/signup" className="text-blue-600 hover:underline">Create an organization</Link>
      </div>
    </AuthShell>
  );
}
