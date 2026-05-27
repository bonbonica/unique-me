import Firecrawl from "@mendable/firecrawl-js";

/**
 * Per-request timeout sent to Firecrawl. Onboarding is interactive, so we
 * cannot afford to wait minutes — if scraping has not returned within 15s we
 * give up and let the analyzer skip the website-derived fields.
 */
const SCRAPE_TIMEOUT_MS = 15_000;

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

  try {
    const client = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });

    const doc = await client.scrape(url, {
      formats: ["markdown"],
      onlyMainContent: true,
      timeout: SCRAPE_TIMEOUT_MS,
    });

    const markdown = doc.markdown?.trim();
    if (!markdown) {
      console.error("[firecrawl] scrape returned no markdown for", url);
      return null;
    }

    return markdown;
  } catch (err) {
    console.error("[firecrawl]", err);
    return null;
  }
}
