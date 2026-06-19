"use client"

import type { ReactNode } from "react"
import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { signIn, signUp } from "@/lib/auth-client"

type SignUpFormProps = {
  showGoogle?: boolean
}

/**
 * Discriminated union for the error state. Most failures are plain strings,
 * but the "account exists + wrong password" branch needs to render inline
 * links to /login and /forgot-password, so we allow ReactNode there.
 */
type FormError =
  | { type: "string"; text: string }
  | { type: "node"; node: ReactNode }

/**
 * Heuristic detector for "this email is already in use" responses from
 * Better Auth. The server reliably returns code `USER_ALREADY_EXISTS`, but
 * older clients and translated messages fall back to a fuzzy text match so
 * we don't miss the case.
 */
function isUserExistsError(err: {
  code?: string | undefined
  message?: string | undefined
}): boolean {
  if (err.code === "USER_ALREADY_EXISTS") return true
  return Boolean(err.message && /exist|already/i.test(err.message))
}

export function SignUpForm({ showGoogle = false }: SignUpFormProps) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState<FormError | null>(null)
  const [isPending, setIsPending] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError({ type: "string", text: "Passwords do not match." })
      return
    }

    if (password.length < 8) {
      setError({
        type: "string",
        text: "Password must be at least 8 characters.",
      })
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
        // Smart fallback: if the email is already registered, try signing the
        // user in with the same credentials. This handles the common
        // "I forgot I already had an account" path without a second form.
        if (isUserExistsError(result.error)) {
          const signInResult = await signIn.email({
            email,
            password,
            callbackURL: "/create",
          })

          if (signInResult.error) {
            // Password didn't match — show a recovery message with inline
            // links to /login and /forgot-password. We never echo the
            // submitted password in the error text.
            setError({
              type: "node",
              node: (
                <>
                  An account already exists for this email, but that password
                  doesn&apos;t match.{" "}
                  <Link href="/login" className="text-primary hover:underline">
                    Sign in
                  </Link>{" "}
                  or{" "}
                  <Link
                    href="/forgot-password"
                    className="text-primary hover:underline"
                  >
                    reset your password
                  </Link>
                  .
                </>
              ),
            })
            return
          }

          toast.success(
            "Welcome back — you already had an account, signed you in."
          )
          router.push("/create")
          router.refresh()
          return
        }

        setError({
          type: "string",
          text: result.error.message || "Could not create your account.",
        })
      } else {
        router.push("/create")
        router.refresh()
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
            className="h-11 bg-muted"
          />
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
