import nodemailer, { type Transporter } from "nodemailer";

/**
 * Sending mail, when there is somewhere to send it.
 *
 * This is a self-hosted app, so it points at SMTP rather than any one
 * provider: a host running it can use Postmark, SES, their own server, or
 * nothing at all. Nothing here knows or cares which.
 *
 * The important part is what happens when it is NOT configured. Sending must
 * never be a prerequisite: an invitation whose email cannot go out is still a
 * valid invitation, and the caller is handed the link to pass on by whatever
 * means they already use. A crew gets its run sheet either way, which is the
 * point of the software.
 */
const env = (key: string): string | undefined => {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : undefined;
};

export const mailConfigured = (): boolean => Boolean(env("SMTP_HOST") && env("SMTP_FROM"));

let cached: Transporter | null = null;
function transport(): Transporter | null {
  if (!mailConfigured()) return null;
  if (cached) return cached;
  const port = Number(env("SMTP_PORT") ?? 587);
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASSWORD");
  cached = nodemailer.createTransport({
    host: env("SMTP_HOST"),
    port,
    // 465 is implicit TLS; everything else starts plain and upgrades.
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
  });
  return cached;
}

export interface SentMail {
  /** Did it actually go? False means the caller must pass the link on. */
  sent: boolean;
  /** Why it did not, in words the person who pressed the button can act on. */
  reason?: string;
}

export async function sendMail(to: string, subject: string, text: string, html?: string): Promise<SentMail> {
  const tx = transport();
  if (!tx) return { sent: false, reason: "No mail server configured (SMTP_HOST and SMTP_FROM)" };
  try {
    await tx.sendMail({ from: env("SMTP_FROM"), to, subject, text, html });
    return { sent: true };
  } catch (err) {
    // Never thrown at the caller: a failed send does not invalidate what the
    // send was about, and the link is still good.
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The invitation itself.
 *
 * Plain text as well as HTML because crew mail lands in every client there is,
 * and a run sheet invitation that arrives as a wall of markup helps nobody.
 */
export function inviteEmail(opts: { url: string; from: string; access: string }): { subject: string; text: string; html: string } {
  const subject = `${opts.from} has invited you to a run sheet`;
  const text = [
    `${opts.from} has given you access to ${opts.access}.`,
    "",
    "Open this link to set your name and a password:",
    opts.url,
    "",
    "The link works once and expires in seven days.",
  ].join("\n");
  const html = [
    `<p><strong>${escapeHtml(opts.from)}</strong> has given you access to ${escapeHtml(opts.access)}.</p>`,
    `<p><a href="${escapeHtml(opts.url)}">Set your name and a password</a></p>`,
    `<p style="color:#666;font-size:13px">The link works once and expires in seven days.<br>${escapeHtml(opts.url)}</p>`,
  ].join("\n");
  return { subject, text, html };
}

const escapeHtml = (v: string): string =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
