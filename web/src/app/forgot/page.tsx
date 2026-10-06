"use client";
import Link from "next/link";
import { useState } from "react";
import { AuthShell, Button, Field, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export default function Forgot() {
  const [sent, setSent] = useState(false);
  return (
    <AuthShell title="Reset password">
      {sent ? (
        <p className="text-sm text-slate-600">If that email has an account, a reset link is on its way.</p>
      ) : (
        <form
          className="space-y-4"
          action={async (fd) => {
            await authClient.requestPasswordReset({ email: String(fd.get("email")), redirectTo: "/reset" });
            setSent(true);
          }}
        >
          <Field label="Email"><Input name="email" type="email" required /></Field>
          <Button className="w-full">Send reset link</Button>
        </form>
      )}
      <Link href="/login" className="mt-4 block text-sm text-blue-600 hover:underline">Back to sign in</Link>
    </AuthShell>
  );
}
