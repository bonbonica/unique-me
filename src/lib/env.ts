import { z } from "zod";

/**
 * Server-side environment variables schema.
 * These variables are only available on the server.
 */
const serverEnvSchema = z.object({
  // Database
  POSTGRES_URL: z.string().url("Invalid database URL"),

  // Authentication
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),

  // OAuth — Google is an optional sign-in method alongside email/password.
  // When unset, the login page hides the Google button and shows only the
  // email/password form. Both vars must be set to register the provider.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // AI
  // Anthropic powers website analysis (Phase 1) and post generation (Phase 2+).
  // Required in all environments — there is no graceful fallback for these
  // features without the API key.
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  // Firecrawl is used to scrape user-supplied business websites during
  // onboarding. Optional in dev so contributors without a Firecrawl account
  // can still work on UI; the scraper short-circuits to null when missing.
  FIRECRAWL_API_KEY: z.string().optional(),
  // OpenAI is reserved for Phase 3 (image generation / DALL·E). Optional in
  // dev for the same reason as Firecrawl.
  OPENAI_API_KEY: z.string().optional(),
  // 32-byte base64 key for AES-256-GCM at-rest encryption of OAuth tokens
  // stored on connected_accounts (Phase 5+). Optional in dev because Phase 1
  // never reads or writes connected_accounts.
  ENCRYPTION_KEY: z.string().optional(),

  // Email delivery. Resend sends the verification and password-reset emails
  // from noreply@uniqueme.app. Required in production; when unset in dev the
  // email helper falls back to logging the link to the server console so a
  // contributor can still complete the verification flow.
  RESEND_API_KEY: z.string().optional(),

  // Storage
  BLOB_READ_WRITE_TOKEN: z.string().optional(),

  // App
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

/**
 * Client-side environment variables schema.
 * These variables are exposed to the browser via NEXT_PUBLIC_ prefix.
 */
const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;

/**
 * Validates and returns server-side environment variables.
 * Throws an error if validation fails.
 */
export function getServerEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error(
      "Invalid server environment variables:",
      parsed.error.flatten().fieldErrors
    );
    throw new Error("Invalid server environment variables");
  }

  return parsed.data;
}

/**
 * Validates and returns client-side environment variables.
 * Throws an error if validation fails.
 */
export function getClientEnv(): ClientEnv {
  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });

  if (!parsed.success) {
    console.error(
      "Invalid client environment variables:",
      parsed.error.flatten().fieldErrors
    );
    throw new Error("Invalid client environment variables");
  }

  return parsed.data;
}

/**
 * Returns true when both Google OAuth credentials are present, so callers can
 * conditionally render the "Continue with Google" button. The login/register
 * pages use this to decide whether to show the social provider section above
 * the email/password form.
 */
export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );
}

/**
 * Checks if required environment variables are set.
 * Logs warnings for missing optional variables.
 */
export function checkEnv(): void {
  const warnings: string[] = [];
  const isProduction = process.env.NODE_ENV === "production";

  // Check required variables
  if (!process.env.POSTGRES_URL) {
    throw new Error("POSTGRES_URL is required");
  }

  if (!process.env.BETTER_AUTH_SECRET) {
    throw new Error("BETTER_AUTH_SECRET is required");
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required");
  }

  // Google OAuth is optional. Both vars must be set to enable the social
  // provider; otherwise the app silently falls back to email/password only.
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    warnings.push(
      "Google OAuth is not configured. Only email/password sign-in will be available."
    );
  }

  // Production-only required vars. In development we warn so contributors can
  // work on non-AI parts of the app without needing every third-party key.
  if (!process.env.FIRECRAWL_API_KEY) {
    if (isProduction) {
      throw new Error("FIRECRAWL_API_KEY is required in production");
    }
    warnings.push(
      "FIRECRAWL_API_KEY is not set. Website scraping during onboarding will be skipped."
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    if (isProduction) {
      throw new Error("OPENAI_API_KEY is required in production");
    }
    warnings.push(
      "OPENAI_API_KEY is not set. AI image generation (Phase 3) will not work."
    );
  }

  if (!process.env.ENCRYPTION_KEY) {
    if (isProduction) {
      throw new Error("ENCRYPTION_KEY is required in production");
    }
    warnings.push(
      "ENCRYPTION_KEY is not set. Social-account token encryption (Phase 5+) will not work."
    );
  }

  // If ENCRYPTION_KEY is set, it must be a 32-byte base64 string (44 chars
  // including `=`). Catches truncated / placeholder values before Phase 5+
  // hands them to AES-256-GCM and silently produces weak keys.
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (encryptionKey && !/^[A-Za-z0-9+/]{43}=$/.test(encryptionKey)) {
    throw new Error(
      "ENCRYPTION_KEY must be a 32-byte base64 string (44 chars including '='). " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    );
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    warnings.push("BLOB_READ_WRITE_TOKEN is not set. Using local storage for file uploads.");
  }

  if (!process.env.RESEND_API_KEY) {
    if (isProduction) {
      throw new Error("RESEND_API_KEY is required in production");
    }
    warnings.push(
      "RESEND_API_KEY is not set. Verification and password-reset links will be logged to the server console instead of emailed."
    );
  }

  // Log warnings in development
  if (process.env.NODE_ENV === "development" && warnings.length > 0) {
    console.warn("\n⚠️  Environment warnings:");
    warnings.forEach((w) => console.warn(`   - ${w}`));
    console.warn("");
  }
}
