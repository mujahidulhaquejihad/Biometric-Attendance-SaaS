import nodemailer from "nodemailer";

type Mail = { to: string | string[]; subject: string; text: string; attachments?: { filename: string; content: Buffer }[] };

let transport: nodemailer.Transporter | null = null;

export async function sendMail(m: Mail) {
  if (!process.env.SMTP_URL) {
    console.log(`[mail] to=${m.to} subject="${m.subject}"\n${m.text}`);
    return;
  }
  transport ??= nodemailer.createTransport(process.env.SMTP_URL);
  await transport.sendMail({ from: process.env.MAIL_FROM, ...m });
}
