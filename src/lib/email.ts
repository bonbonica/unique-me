import { Resend } from "resend"

/**
 * Centralized email transport for transactional auth emails (verification,
 * password reset). The Resend client is created lazily on the first call so
 * that local development without RESEND_API_KEY does not crash at module load
 * — in that case we fall back to the console-log transport.
 *
 * Sender is locked to noreply@uniqueme.app (the verified domain in Resend).
 * The friendly name "UniqueMe" gives mail clients a clean inbox display.
 */

const FROM_ADDRESS = "UniqueMe <noreply@uniqueme.app>"

let cachedClient: Resend | null = null
let cachedClientChecked = false

function getResendClient(): Resend | null {
  if (cachedClientChecked) return cachedClient
  cachedClientChecked = true
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    cachedClient = null
    return null
  }
  cachedClient = new Resend(apiKey)
  return cachedClient
}

type SendEmailArgs = {
  to: string
  subject: string
  html: string
  text: string
  /**
   * Short tag used to label the dev-only console fallback so a developer can
   * tell verification vs. reset traffic apart in their terminal.
   */
  logLabel: string
}

async function sendEmail({
  to,
  subject,
  html,
  text,
  logLabel,
}: SendEmailArgs): Promise<void> {
  const client = getResendClient()

  if (!client) {
    // Dev fallback: no API key configured, keep the prior console-log behavior
    // so contributors can still complete the verification flow locally.
    // eslint-disable-next-line no-console
    console.log(
      `\n${"=".repeat(60)}\n${logLabel} (RESEND_API_KEY not set — console fallback)\nTo: ${to}\nSubject: ${subject}\n\n${text}\n${"=".repeat(60)}\n`
    )
    return
  }

  const { error } = await client.emails.send({
    from: FROM_ADDRESS,
    to,
    subject,
    html,
    text,
  })

  if (error) {
    console.error(`[email] ${logLabel} failed`, error)
    // Re-throw so Better Auth surfaces the failure to the caller rather than
    // silently dropping the message. The sign-up handler turns this into a
    // generic "could not create your account" error.
    throw new Error(`Failed to send ${logLabel.toLowerCase()}: ${error.message}`)
  }
}

/**
 * Minimal inline-styled HTML email template. Inline styles are necessary
 * because most mail clients strip <style> blocks and ignore external CSS. The
 * palette mirrors DESIGN.md's light-mode tokens — cream background, antique
 * brass primary — so the email reads on-brand without depending on the user's
 * client respecting dark mode.
 */
function renderEmailHtml({
  preheader,
  heading,
  bodyText,
  ctaLabel,
  ctaUrl,
  footnote,
}: {
  preheader: string
  heading: string
  bodyText: string
  ctaLabel: string
  ctaUrl: string
  footnote: string
}): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${heading}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4efe5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#2a2218;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4efe5;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border-radius:18px;padding:40px;">
            <tr>
              <td>
                <p style="margin:0 0 24px;font-size:14px;letter-spacing:0.12em;text-transform:uppercase;color:#8a6a3f;font-weight:600;">UniqueMe</p>
                <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;font-weight:500;color:#2a2218;">${heading}</h1>
                <p style="margin:0 0 28px;font-size:16px;line-height:1.6;color:#5a4e3d;">${bodyText}</p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="border-radius:9999px;background-color:#a87a3a;">
                      <a href="${ctaUrl}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:500;color:#fffbf2;text-decoration:none;border-radius:9999px;">${ctaLabel}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:32px 0 0;font-size:13px;line-height:1.6;color:#8a7e6c;">If the button doesn't work, paste this URL into your browser:<br /><a href="${ctaUrl}" style="color:#8a6a3f;word-break:break-all;">${ctaUrl}</a></p>
                <hr style="border:none;border-top:1px solid #ece3d2;margin:32px 0;" />
                <p style="margin:0;font-size:13px;line-height:1.6;color:#8a7e6c;">${footnote}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

export async function sendVerificationEmail({
  to,
  name,
  url,
}: {
  to: string
  name?: string | null
  url: string
}): Promise<void> {
  const greeting = name ? `Hi ${name},` : "Welcome,"
  const bodyText = `${greeting} confirm your email address to activate your UniqueMe account. The link below expires in 1 hour.`
  const text = `${greeting}\n\nConfirm your email to activate your UniqueMe account:\n${url}\n\nThe link expires in 1 hour. If you didn't create an account, you can safely ignore this email.`

  await sendEmail({
    to,
    subject: "Verify your UniqueMe email",
    text,
    html: renderEmailHtml({
      preheader: "Confirm your email to activate your UniqueMe account.",
      heading: "Verify your email",
      bodyText,
      ctaLabel: "Verify email",
      ctaUrl: url,
      footnote:
        "If you didn't create a UniqueMe account, you can safely ignore this email.",
    }),
    logLabel: "EMAIL VERIFICATION",
  })
}

export async function sendPasswordResetEmail({
  to,
  name,
  url,
}: {
  to: string
  name?: string | null
  url: string
}): Promise<void> {
  const greeting = name ? `Hi ${name},` : "Hi,"
  const bodyText = `${greeting} we received a request to reset your UniqueMe password. Click the button below to choose a new one. The link expires in 1 hour.`
  const text = `${greeting}\n\nReset your UniqueMe password:\n${url}\n\nThe link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email — your password will stay the same.`

  await sendEmail({
    to,
    subject: "Reset your UniqueMe password",
    text,
    html: renderEmailHtml({
      preheader: "Reset your UniqueMe password.",
      heading: "Reset your password",
      bodyText,
      ctaLabel: "Reset password",
      ctaUrl: url,
      footnote:
        "If you didn't ask to reset your password, you can safely ignore this email — your password won't change.",
    }),
    logLabel: "PASSWORD RESET",
  })
}
