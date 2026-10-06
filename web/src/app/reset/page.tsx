"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthShell, Button, Field, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const [error, setError] = useState("");
  return (
    <form
      className="space-y-4"
      action={async (fd) => {
        const r = await authClient.resetPassword({ newPassword: String(fd.get("password")), token });
        if (r.error) return setError(r.error.message ?? "Reset failed");
        router.push("/login");
      }}
    >
      <Field label="New password" hint="At least 8 characters">
        <Input name="password" type="password" minLength={8} required autoComplete="new-password" />
      </Field>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <Button className="w-full" disabled={!token}>Set password</Button>
    </form>
  );
}

export default function Reset() {
  return (
    <AuthShell title="Choose a password">
      <Suspense>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
