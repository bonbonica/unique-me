import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { subscriptionService } from "@/lib/services"
import { db } from "./db"

// Google OAuth is optional. If both env vars are set we register the social
// provider; otherwise the login page transparently falls back to email/password
// only. Keeping this conditional (rather than throwing at module load) lets
// contributors run the app without a Google Cloud project.
const googleClientId = process.env.GOOGLE_CLIENT_ID
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET

export const auth = betterAuth({
  baseURL:
    process.env.BETTER_AUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000",
  database: drizzleAdapter(db, { provider: "pg" }),
  ...(googleClientId && googleClientSecret
    ? {
        socialProviders: {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          },
        },
      }
    : {}),
  emailAndPassword: {
    enabled: true,
    // No email provider is wired up yet (Phase 1). The reset link is logged
    // to the terminal so a developer can copy it during local testing. When
    // we add a transactional email service this handler swaps to that call.
    sendResetPassword: async ({ user, url }) => {
      // Dev-only transport: the reset link is printed to the server log until
      // a real email provider lands.
      // eslint-disable-next-line no-console
      console.log(
        `\n${"=".repeat(60)}\nPASSWORD RESET\nUser: ${user.email}\nReset URL: ${url}\n${"=".repeat(60)}\n`
      )
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    // Same dev-only console transport as sendResetPassword above.
    sendVerificationEmail: async ({ user, url }) => {
      // Dev-only transport: the verification link is printed to the server
      // log until a real email provider lands.
      // eslint-disable-next-line no-console
      console.log(
        `\n${"=".repeat(60)}\nEMAIL VERIFICATION\nUser: ${user.email}\nVerification URL: ${url}\n${"=".repeat(60)}\n`
      )
    },
  },
  account: {
    accountLinking: {
      // Auto-link an OAuth sign-in to an existing user when the verified
      // email matches. The trusted list is Google-only by design.
      enabled: true,
      trustedProviders: ["google"],
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          try {
            await subscriptionService.startTrial(user.id)
          } catch (err) {
            console.error("[auth] user-create startTrial failed", err)
          }
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          try {
            await subscriptionService.startTrial(session.userId)
          } catch (err) {
            console.error("[auth] session-create startTrial failed", err)
          }
        },
      },
    },
  },
})
