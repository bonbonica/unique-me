import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { SignUpForm } from "@/components/auth/sign-up-form"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { auth } from "@/lib/auth"
import { isGoogleOAuthConfigured } from "@/lib/env"

export default async function RegisterPage() {
  const session = await auth.api.getSession({ headers: await headers() })

  if (session) {
    redirect("/create")
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Create an account</CardTitle>
          <CardDescription>Get started with your new account</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center">
          <SignUpForm showGoogle={isGoogleOAuthConfigured()} />
        </CardContent>
      </Card>
    </div>
  )
}
