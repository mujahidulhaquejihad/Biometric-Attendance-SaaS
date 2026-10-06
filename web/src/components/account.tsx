"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button, Card, Field, Input } from "./ui";

export function AccountForms({ twoFactorEnabled }: { twoFactorEnabled: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const secret = totpUri ? new URL(totpUri).searchParams.get("secret") : null;

  return (
    <div className="space-y-6">
      {msg && <p className="rounded-md bg-slate-100 px-3 py-2 text-sm" role="status">{msg}</p>}

      <Card title="Change password">
        <form
          className="grid gap-3 sm:grid-cols-2"
          action={async (fd) => {
            const r = await authClient.changePassword({
              currentPassword: String(fd.get("current")),
              newPassword: String(fd.get("next")),
              revokeOtherSessions: true,
            });
            setMsg(r.error ? (r.error.message ?? "Failed") : "Password changed.");
          }}
        >
          <Field label="Current password"><Input name="current" type="password" required autoComplete="current-password" /></Field>
          <Field label="New password"><Input name="next" type="password" minLength={8} required autoComplete="new-password" /></Field>
          <div><Button>Update password</Button></div>
        </form>
      </Card>

      <Card title="Two-factor authentication">
        {twoFactorEnabled ? (
          <form
            className="flex items-end gap-3"
            action={async (fd) => {
              const r = await authClient.twoFactor.disable({ password: String(fd.get("password")) });
              setMsg(r.error ? (r.error.message ?? "Failed") : "Two-factor disabled.");
              router.refresh();
            }}
          >
            <Field label="Password" className="flex-1"><Input name="password" type="password" required /></Field>
            <Button variant="danger">Disable 2FA</Button>
          </form>
        ) : totpUri ? (
          <form
            className="space-y-3"
            action={async (fd) => {
              const r = await authClient.twoFactor.verifyTotp({ code: String(fd.get("code")) });
              setMsg(r.error ? (r.error.message ?? "Invalid code") : "Two-factor enabled.");
              if (!r.error) {
                setTotpUri("");
                router.refresh();
              }
            }}
          >
            <p className="text-sm text-slate-600">
              Add this key to Google Authenticator, Microsoft Authenticator, or 1Password, then enter the 6-digit code.
            </p>
            <code className="block break-all rounded bg-slate-100 p-2 text-sm">{secret}</code>
            <Field label="Code"><Input name="code" inputMode="numeric" required /></Field>
            <Button>Verify and enable</Button>
          </form>
        ) : (
          <form
            className="flex items-end gap-3"
            action={async (fd) => {
              const r = await authClient.twoFactor.enable({ password: String(fd.get("password")) });
              if (r.error) return setMsg(r.error.message ?? "Failed");
              if (r.data && "totpURI" in r.data) setTotpUri(r.data.totpURI);
            }}
          >
            <Field label="Confirm password" className="flex-1"><Input name="password" type="password" required /></Field>
            <Button>Enable 2FA</Button>
          </form>
        )}
      </Card>
    </div>
  );
}
