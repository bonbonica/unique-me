import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { logError } from "@/lib/log"
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
    // Anchor the 7-day free trial to the verification moment, not the signup
    // moment. Email/password signups skip startTrial in the user-create hook
    // (emailVerified is false at that point), so this is where their trial
    // clock actually starts. Idempotent via onConflictDoNothing.
    afterEmailVerification: async (user) => {
      try {
        await subscriptionService.startTrial(user.id)
      } catch (err) {
        logError("auth.afterEmailVerification.startTrial_failed", {
          userId: user.id,
          err,
        })
      }
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
          // Only start the trial here for users who are already verified at
          // creation — i.e. Google OAuth (BetterAuth marks trustedProviders
          // accounts as emailVerified: true at user-create time). Email/password
          // signups arrive here with emailVerified: false and start their trial
          // later via the emailVerification.afterEmailVerification hook so the
          // 7-day clock anchors to the verification moment, not the signup
          // moment.
          if (!user.emailVerified) return
          try {
            await subscriptionService.startTrial(user.id)
          } catch (err) {
            logError("auth.user_create.startTrial_failed", {
              userId: user.id,
              err,
            })
          }
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          // Defensive fallback: idempotent (onConflictDoNothing on user_id) so
          // it's a no-op once a trial row already exists. Catches the rare case
          // where the verification hook above failed but a session still got
          // created.
          try {
            await subscriptionService.startTrial(session.userId)
          } catch (err) {
            logError("auth.session_create.startTrial_failed", {
              userId: session.userId,
              err,
            })
          }
        },
      },
    },
  },
})
