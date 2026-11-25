/**
 * Outbound mail, via Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
 *
 *   RESEND_API_KEY  required to actually send
 *   MAIL_FROM       e.g. "Tesella <no-reply@yourdomain.com>" — the domain must be
 *                   verified in Resend, or Resend rejects the send
 *
 * Without a key, codes are printed to the server console: right for local
 * development, and the server refuses to run that way in production (see index.js).
 */
const { RESEND_API_KEY, MAIL_FROM } = process.env;

export const mailConfigured = () => !!RESEND_API_KEY;

if (RESEND_API_KEY) console.log(`[mail] sending through Resend as ${MAIL_FROM || "(MAIL_FROM not set!)"}`);
else console.log("[mail] RESEND_API_KEY not set — codes will print here instead of being emailed");

const PURPOSE = {
  verify: { subject: (c) => `${c} is your Tesella code`, line: "Here's the code to verify your email" },
  reset: { subject: (c) => `${c} is your Tesella password reset code`, line: "Here's the code to reset your password" },
};

// Usernames are already restricted to [A-Za-z0-9_], but escape anyway:
// this string goes into HTML.
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Sends a 5-digit code. Throws if Resend refuses it, so the caller can log it. */
export async function sendCode(to, code, username, purpose = "verify") {
  const p = PURPOSE[purpose] || PURPOSE.verify;
  if (!RESEND_API_KEY) {
    console.log(`\n[mail] ── ${purpose} code for ${to}: ${code} ──\n`);
    return { delivered: false };
  }
  const text =
    `Hi ${username},\n\n${p.line}: ${code}\n\n` +
    `It expires in 15 minutes. If this wasn't you, you can ignore this email.\n`;
  const html =
    `<p>Hi ${esc(username)},</p><p>${p.line}:</p>` +
    `<p style="font-size:28px;letter-spacing:6px;font-family:monospace"><b>${code}</b></p>` +
    `<p>It expires in 15 minutes. If this wasn't you, you can ignore this email.</p>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject: p.subject(code), text, html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${body.slice(0, 200)}`);
  }
  return { delivered: true };
}
