import "server-only";

import { Resend } from "resend";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendTransactionalEmail({ to, subject, text, html, idempotencyKey }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !from) {
    return { sent: false, error: "Resend is not configured." };
  }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({ from, to, subject, text, html }, { idempotencyKey });
    if (error) return { sent: false, error: error.message };
    return { sent: true };
  } catch {
    return { sent: false, error: "Email provider request failed." };
  }
}

export async function sendWelcomeEmail(email, firstName) {
  const greeting = firstName ? `Hello ${firstName},` : "Hello,";
  const text = `${greeting}\n\nWelcome to Attendance. Your account has been created. Use the sign-in page to access your attendance workspace.`;
  const html = `<p>${escapeHtml(greeting)}</p><p>Welcome to Attendance. Your account has been created.</p><p>Use the sign-in page to access your attendance workspace.</p>`;

  return sendTransactionalEmail({
    to: email,
    subject: "Welcome to Attendance",
    text,
    html,
  });
}

export function renderNotificationEmail(title, message) {
  return {
    subject: title,
    text: message,
    html: `<main style="font-family:Arial,sans-serif;line-height:1.5"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main>`,
  };
}