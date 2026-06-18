import Firecrawl from "@mendable/firecrawl-js";

/**
 * Per-request timeout sent to Firecrawl. Onboarding is interactive but the
 * user already sees a "Reading your website…" spinner, so we can afford a
 * generous ceiling. 30s comfortably covers cold-starting target sites
 * (free-tier Vercel/Render/Heroku) that take 5–20s to wake before they
 * begin to render — the symptom that motivated this value.
 */
const SCRAPE_TIMEOUT_MS = 30_000;

/**
 * Delay between the first attempt and the single retry. The retry exists
 * to handle the common cold-start case: the first request wakes the target
 * site, the second one usually succeeds against the now-warm container.
 */
const RETRY_BACKOFF_MS = 2_000;

/**
 * Window for Firecrawl's server-side scrape cache (milliseconds). If the
 * same URL was scraped within the last 24h, Firecrawl returns the cached
 * scrape immediately — which means the retry after a transient failure is
 * effectively free when a recent successful scrape exists.
 */
const SCRAPE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

/**
 * Scrape a single URL and return its main content as markdown.
 *
 * Contract: this function NEVER throws. It returns:
 *   - The markdown body string on success.
 *   - `null` if the URL is invalid, the API key is missing, the scrape
 *     reports failure, the response has no markdown body, or any error is
 *     thrown internally.
 *
 * Callers should treat `null` as "scraping unavailable" and continue with
 * whatever signal they already have (e.g. the user's business description).
 */
export async function scrapeWebsite(url: string): Promise<string | null> {
  if (!process.env.FIRECRAWL_API_KEY) {
    // Local-dev contributors may not have a Firecrawl account. This warning
    // matches the one logged by `checkEnv` so the cause is easy to trace.
    console.warn(
      "[firecrawl] FIRECRAWL_API_KEY is not set; skipping scrape"
    );
    return null;
  }

  // Cheap pre-validation: Firecrawl will reject non-HTTP URLs anyway, but we
  // can short-circuit without burning a network call.
  if (!/^https?:\/\//i.test(url)) {
    console.error("[firecrawl] invalid URL (must start with http/https):", url);
    return null;
  }

  const client = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });

  // Two attempts total: one immediate, one after a short backoff. The retry
  // is the main reliability lever for cold-starting target sites — the first
  // call wakes the site, the second usually lands once the container is
  // warm. `maxAge` makes that second call effectively free when a recent
  // successful scrape exists in Firecrawl's cache.
  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const doc = await client.scrape(url, {
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: SCRAPE_TIMEOUT_MS,
        maxAge: SCRAPE_MAX_AGE_MS,
      });

      const markdown = doc.markdown?.trim();
      if (!markdown) {
        // Empty body isn't transient — retrying won't help.
        console.error("[firecrawl] scrape returned no markdown", {
          url,
          attempt,
        });
        return null;
      }

      return markdown;
    } catch (err) {
      const errorObj = err as { status?: number; cause?: unknown };
      console.error("[firecrawl] scrape failed", {
        url,
        attempt,
        message: err instanceof Error ? err.message : String(err),
        status: errorObj?.status,
        cause: errorObj?.cause,
      });

      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
        continue;
      }
      return null;
    }
  }

  // Unreachable: the loop always returns or falls through to `return null`
  // inside the catch on the final attempt. Required for the return type.
  return null;
}
