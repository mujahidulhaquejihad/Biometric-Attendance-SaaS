import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { organization, twoFactor } from "better-auth/plugins";
import { prisma } from "./db";
import { sendMail } from "./mail";

const superAdmins = (process.env.SUPER_ADMIN_EMAILS ?? "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);

export const auth = betterAuth({
  appName: "Attendance",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: "Set your Attendance password",
        text: `Hello ${user.name},\n\nUse this link to set your password:\n${url}\n\nIf you did not expect this, ignore this email.`,
      });
    },
  },
  user: {
    additionalFields: { isSuperAdmin: { type: "boolean", defaultValue: false, input: false } },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({ data: { ...user, isSuperAdmin: superAdmins.includes(user.email.toLowerCase()) } }),
      },
    },
  },
  plugins: [organization(), twoFactor(), nextCookies()],
});
