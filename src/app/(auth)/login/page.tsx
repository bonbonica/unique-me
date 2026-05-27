import { headers } from "next/headers"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Sparkles } from "lucide-react"
import { EmailPasswordSignInForm } from "@/components/auth/email-password-sign-in-form"
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button"
import { Card } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { auth } from "@/lib/auth"
import { isGoogleOAuthConfigured } from "@/lib/env"

/**
 * Login page server shell.
 *
 * Layout follows DESIGN.md § 8.D (auth / focal-task screen): a single centered
 * Card on the auth radial gradient. The card holds, in order:
 *   1. Sparkles icon in a gradient tile
 *   2. Heading + sub-heading
 *   3. (optional) Google button + divider — only when both Google env vars are set
 *   4. Email/password form (the client-island component)
 *   5. "Create an account" footer link
 *
 * The `?reset=success` query string is set by the reset-password flow after a
 * successful password change; we surface a small confirmation banner so the
 * user knows their new password is active.
 */
type LoginPageProps = {
  searchParams: Promise<{ reset?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await auth.api.getSession({ headers: await headers() })

  if (session) {
    redirect("/dashboard")
  }

  const { reset } = await searchParams
  const showResetSuccess = reset === "success"
  const googleEnabled = isGoogleOAuthConfigured()

  return (
    <div className="auth-bg min-h-[calc(100vh-4rem)] flex items-center justify-center px-5 sm:px-8">
      <Card className="max-w-md w-full p-8 rounded-2xl shadow-float">
        <div className="mx-auto size-14 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/10 border border-primary/30 flex items-center justify-center">
          <Sparkles className="size-7 text-primary" />
        </div>

        <h1 className="font-fraunces text-3xl tracking-tight font-medium text-center mt-6">
          Welcome back.
        </h1>

        <p className="text-base text-muted-foreground leading-7 text-center mt-3 max-w-xs mx-auto">
          Sign in to continue.
        </p>

        {showResetSuccess && (
          <p className="mt-6 text-sm text-center text-primary">
            Password reset successfully. Sign in with your new password.
          </p>
        )}

        <div className="mt-8 space-y-6">
          {googleEnabled && (
            <>
              <GoogleSignInButton callbackURL="/dashboard" />
              {/* Centered "or" overlay sits on top of a horizontal Separator
                  so it reads as a label rather than an interruption. The
                  bg-card class matches the Card surface beneath so the line
                  appears to break around the word. */}
              <div className="relative">
                <Separator />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-3 text-xs text-muted-foreground">
                  or
                </span>
              </div>
            </>
          )}

          <EmailPasswordSignInForm />
        </div>

        <p className="text-center text-sm text-muted-foreground mt-6">
          New here?{" "}
          <Link href="/register" className="text-primary hover:underline">
            Create an account
          </Link>
          .
        </p>
      </Card>
    </div>
  )
}
