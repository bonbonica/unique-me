import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { subscriptionService } from "@/lib/services"
import { db } from "./db"
import {
  sendPasswordResetEmail,
  sendVerificationEmail as deliverVerificationEmail,
} from "./email"

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
    // Block sign-in until the email is verified. Google sign-ins are exempt
    // because Better Auth marks OAuth emails as verified at creation time.
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail({ to: user.email, name: user.name, url })
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    // Re-send the verification link if an unverified user tries to sign in,
    // so they can recover without leaving the login screen.
    sendOnSignIn: true,
    // After the user clicks the verification link, create a session and drop
    // them on the callbackURL captured at sign-up time (currently `/create`).
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await deliverVerificationEmail({ to: user.email, name: user.name, url })
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
  // Brute-force + abuse protection on the auth endpoints. BetterAuth's built-in
  // limiter is enabled by default in production; we keep that default and add
  // per-path overrides for the sensitive endpoints. Storage is "database" so
  // counts are shared across serverless function instances (memory storage is
  // per-instance and an attacker can spread requests across cold starts).
  rateLimit: {
    storage: "database",
    customRules: {
      // Covers /sign-in/email and /sign-in/social. 5 attempts/minute/IP is
      // enough for fat-fingered passwords without giving brute force room.
      "/sign-in/*": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 5 },
      // Password-reset + verification emails cost money (Resend) — keep these
      // tighter than sign-in.
      "/forget-password": { window: 60, max: 3 },
      "/reset-password": { window: 60, max: 5 },
      "/send-verification-email": { window: 60, max: 3 },
      // Verification link is clicked from an email; tolerate retries.
      "/verify-email": { window: 60, max: 10 },
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
