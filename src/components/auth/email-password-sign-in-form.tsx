"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { signIn } from "@/lib/auth-client"

/**
 * Standalone email + password sign-in form for the login page. The page shell
 * owns the Google button, divider, and the "create an account" footer — this
 * component is responsible only for the credential form so it stays a small
 * client island under an otherwise-server page.
 */
export function EmailPasswordSignInForm() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [isPending, setIsPending] = useState(false)
  // Set when sign-in is rejected because the email isn't verified yet. Better
  // Auth's sendOnSignIn re-issues the verification link in that same response,
  // so we can confidently tell the user a fresh email is on the way.
  const [verificationSentTo, setVerificationSentTo] = useState<string | null>(
    null
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setIsPending(true)

    try {
      const result = await signIn.email({
        email,
        password,
        callbackURL: "/create",
      })

      if (result.error) {
        if (result.error.code === "EMAIL_NOT_VERIFIED") {
          setVerificationSentTo(email)
          return
        }
        setError(result.error.message || "Could not sign in with those credentials.")
      } else {
        // Use both push + refresh so server components re-render with the new
        // session cookie on the destination route.
        router.push("/create")
        router.refresh()
      }
    } catch {
      setError("Something went wrong. Please try again.")
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
            Verify your email
          </h2>
          <p className="text-base text-muted-foreground leading-7">
            We sent a new verification link to{" "}
            <span className="text-foreground">{verificationSentTo}</span>. Click
            it to finish setting up your account.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setVerificationSentTo(null)
            setPassword("")
          }}
          className="text-sm text-primary hover:underline"
        >
          Back to sign in
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
          autoComplete="current-password"
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          disabled={isPending}
          className="h-11 bg-muted"
        />
        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            Forgot password?
          </Link>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive text-center">{error}</p>
      )}

      <Button
        type="submit"
        size="lg"
        className="w-full rounded-full"
        disabled={isPending}
      >
        {isPending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  )
}
