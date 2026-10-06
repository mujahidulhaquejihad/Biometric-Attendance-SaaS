"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createOrganization } from "@/lib/org";

const schema = z.object({
  company: z.string().trim().min(2).max(100),
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone"),
});

export async function signUp(_: { error: string }, fd: FormData) {
  const p = schema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0].message };
  const { company, name, email, password, timezone } = p.data;

  let token: string;
  let userId: string;
  try {
    const r = await auth.api.signUpEmail({ body: { name, email, password }, headers: await headers() });
    token = r.token!;
    userId = r.user.id;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Sign-up failed" };
  }

  const org = await createOrganization(company, timezone, userId, name);
  await prisma.session.update({ where: { token }, data: { activeOrganizationId: org.id } });
  redirect("/today");
}
