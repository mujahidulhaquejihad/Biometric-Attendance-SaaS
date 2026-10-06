import { AccountForms } from "@/components/account";
import { PageHeader } from "@/components/ui";
import { getCtx } from "@/lib/session";

export const metadata = { title: "Account" };

export default async function Account() {
  const ctx = await getCtx();
  return (
    <div className="max-w-2xl">
      <PageHeader title="Account" description={ctx.user.email} />
      <AccountForms twoFactorEnabled={!!(ctx.user as { twoFactorEnabled?: boolean }).twoFactorEnabled} />
    </div>
  );
}
