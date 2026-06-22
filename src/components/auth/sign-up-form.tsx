"use client"

import type { ReactNode } from "react"
import { useState } from "react"
import Link from "next/link"
import { Mail } from "lucide-react"
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button"
import { PasswordStrengthMeter } from "@/components/auth/password-strength-meter"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { signUp } from "@/lib/auth-client"
import { evaluatePassword, getFriendlyError } from "@/lib/password-strength"

type SignUpFormProps = {
  showGoogle?: boolean
}

/**
 * Discriminated union for the error state. Most failures are plain strings,
 * but the "account may already exist" branch renders inline links to /login
 * and /forgot-password, so we allow ReactNode there.
 */
type FormError =
  | { type: "string"; text: string }
  | { type: "node"; node: ReactNode }

export function SignUpForm({ showGoogle = false }: SignUpFormProps) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState<FormError | null>(null)
  const [isPending, setIsPending] = useState(false)
  // Email address the verification link was sent to. When set, the form is
  // replaced with a "check your inbox" confirmation panel.
  const [verificationSentTo, setVerificationSentTo] = useState<string | null>(
    null
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError({ type: "string", text: "Passwords do not match." })
      return
    }

    const { isValid, checks } = evaluatePassword(password)
    if (!isValid) {
      setError({ type: "string", text: getFriendlyError(checks) })
      return
    }

    setIsPending(true)

    try {
      const result = await signUp.email({
        name,
        email,
        password,
        callbackURL: "/create",
      })

      if (result.error) {
        // USER_ALREADY_EXISTS is rendered with the same symmetric copy as a
        // generic failure so we never confirm to an attacker whether a given
        // email is registered (user enumeration). The previous "smart sign-in"
        // fallback also bypassed the /sign-in/* rate limit by re-firing
        // credentials through the registration endpoint — that path is gone.
        if (result.error.code === "USER_ALREADY_EXISTS") {
          setError({
            type: "node",
            node: (
              <>
                We couldn&apos;t create that account. If you already have one,
                try{" "}
                <Link href="/login" className="text-primary hover:underline">
                  signing in
                </Link>{" "}
                instead.{" "}
                <Link
                  href="/forgot-password"
                  className="text-primary hover:underline"
                >
                  forgot password?
                </Link>
              </>
            ),
          })
          return
        }

        setError({
          type: "string",
          text: result.error.message || "Could not create your account.",
        })
      } else {
        // Fresh sign-up succeeded. Better Auth has mailed a verification link
        // (sendOnSignUp) and requireEmailVerification blocks sign-in until
        // it's clicked, so we hold the user on a confirmation panel rather
        // than routing into the authenticated app.
        setVerificationSentTo(email)
      }
    } catch {
      setError({
        type: "string",
        text: "Something went wrong. Please try again.",
      })
    } finally {
      setIsPending(false)
    }
  }

  if (verificationSentTo) {
    return (
      <div className="w-full space-y-6 text-center">
        <div className="mx-auto size-12 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center">
          <Mail className="size-6 text-primary" strokeWidth={1.5} />
        </div>
        <div className="space-y-3">
          <h2 className="font-fraunces text-2xl tracking-tight font-medium">
            Check your email
          </h2>
          <p className="text-base text-muted-foreground leading-7">
            We sent a verification link to{" "}
            <span className="text-foreground">{verificationSentTo}</span>. Click
            the link to activate your account, then you&apos;ll be signed in.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Wrong address?{" "}
          <button
            type="button"
            onClick={() => {
              setVerificationSentTo(null)
              setError(null)
            }}
            className="text-primary hover:underline"
          >
            Start over
          </button>
          .
        </p>
      </div>
    )
  }

  return (
    <div className="w-full space-y-6">
      {showGoogle && (
        <>
          <GoogleSignInButton callbackURL="/create" />
          <div className="relative">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-3 text-xs text-muted-foreground">
              or
            </span>
          </div>
        </>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            type="text"
            autoComplete="name"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={isPending}
            className="h-11 bg-muted"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={isPending}
            className="h-11 bg-muted"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="Create a password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={isPending}
            aria-describedby="password-requirements"
            className="h-11 bg-muted"
          />
          <PasswordStrengthMeter
            password={password}
            className="pt-1"
          />
          <p id="password-requirements" className="sr-only">
            Password must be at least 8 characters and include a letter, a
            number, and a symbol.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder="Confirm your password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            disabled={isPending}
            className="h-11 bg-muted"
          />
        </div>

        {error && (
          <p className="text-sm text-destructive text-center">
            {error.type === "string" ? error.text : error.node}
          </p>
        )}

        <Button
          type="submit"
          size="lg"
          className="w-full rounded-full"
          disabled={isPending}
        >
          {isPending ? "Creating account…" : "Create account"}
        </Button>

        <div className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Sign in
          </Link>
          .
        </div>
      </form>
    </div>
  )
}
