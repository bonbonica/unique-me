"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { signIn } from "@/lib/auth-client"

type GoogleSignInButtonProps = {
  callbackURL?: string
}

export function GoogleSignInButton({
  callbackURL = "/dashboard",
}: GoogleSignInButtonProps) {
  const [error, setError] = useState("")
  const [isPending, setIsPending] = useState(false)

  const handleGoogleSignIn = async () => {
    setError("")
    setIsPending(true)

    try {
      await signIn.social({
        provider: "google",
        callbackURL,
      })
    } catch {
      setError("Failed to sign in with Google")
      setIsPending(false)
    }
  }

  return (
    <div className="w-full max-w-sm space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleGoogleSignIn}
        disabled={isPending}
      >
        {isPending ? "Redirecting..." : "Continue with Google"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
