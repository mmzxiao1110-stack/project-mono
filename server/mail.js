/**
 * Outbound mail.
 *
 * With SMTP configured, codes are emailed. Without it, they're printed to the
 * server console — which is what you want in development, and is why signup
 * works before you've set any of this up.
 */
import nodemailer from "nodemailer";

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;

let transport = null;
if (SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  console.log(`[mail] SMTP via ${SMTP_HOST}`);
} else {
  console.log("[mail] no SMTP configured — verification codes will print here");
}

export async function sendCode(to, code, username) {
  if (!transport) {
    console.log(`\n[mail] ──────────────────────────────`);
    console.log(`[mail] to:   ${to}`);
    console.log(`[mail] code: ${code}`);
    console.log(`[mail] ──────────────────────────────\n`);
    return { delivered: false };
  }
  await transport.sendMail({
    from: MAIL_FROM || `Turf Blocks <no-reply@${SMTP_HOST}>`,
    to,
    subject: `${code} is your Turf Blocks code`,
    text:
      `Hi ${username},\n\n` +
      `Your verification code is ${code}\n\n` +
      `It expires in 15 minutes. If you didn't sign up, ignore this email.\n`,
    html:
      `<p>Hi ${username},</p>` +
      `<p style="font-size:28px;letter-spacing:6px;font-family:monospace"><b>${code}</b></p>` +
      `<p>It expires in 15 minutes. If you didn't sign up, ignore this email.</p>`,
  });
  return { delivered: true };
}