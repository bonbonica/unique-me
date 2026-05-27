/**
 * Content policy gate for onboarding (Phase 1).
 *
 * UniqueMe will generate marketing copy with an AI model on the user's behalf.
 * We refuse to do that for categories that (a) require advertising approvals
 * UniqueMe does not have on the social platforms, (b) carry meaningful legal
 * exposure across jurisdictions, or (c) are restricted by Anthropic's
 * acceptable use policy.
 *
 * This is a deliberately conservative keyword scan — false positives are
 * acceptable (the user can adjust their description), false negatives are
 * not. Keep keywords lowercased; matching is case-insensitive after
 * normalisation.
 *
 * NOTE on cannabis: even where state-legal in the US, cannabis remains
 * federally illegal and is restricted advertising on every major social
 * platform. We block for v1 to keep the policy simple; we can revisit per
 * jurisdiction once the rest of the product is stable.
 */

type Category =
  | "alcohol"
  | "adult"
  | "gambling"
  | "weapons"
  | "illegal_substances";

const BLOCKED_KEYWORDS: ReadonlyArray<{
  category: Category;
  keywords: ReadonlyArray<string>;
}> = [
  {
    category: "alcohol",
    keywords: [
      "alcohol",
      "liquor",
      "wine bar",
      "winery",
      "brewery",
      "distillery",
      "whiskey",
      "whisky",
      "vodka",
      "tequila",
      "rum",
      "cocktail bar",
      "nightclub",
    ],
  },
  {
    category: "adult",
    keywords: [
      "adult content",
      "adult entertainment",
      "pornography",
      "escort",
      "cam site",
      "nsfw",
      "xxx",
    ],
  },
  {
    category: "gambling",
    keywords: [
      "gambling",
      "casino",
      "sportsbook",
      "online betting",
      "poker room",
      "slot machine",
    ],
  },
  {
    category: "weapons",
    keywords: [
      "firearms",
      "handgun",
      "assault rifle",
      "ammunition dealer",
      "gun shop",
      "weapon",
      "explosive",
    ],
  },
  {
    category: "illegal_substances",
    keywords: [
      "cannabis",
      "marijuana",
      "cbd shop",
      "dispensary",
      "kratom shop",
      "recreational drug",
    ],
  },
];

/**
 * Single, deliberately bland refusal message shown to users whose business
 * description matched a blocked keyword. We do not tell the user which
 * category matched — that would invite gaming the filter — and we do not
 * apologise, which sounds like an invitation to negotiate.
 */
const BLOCK_REASON =
  "UniqueMe is designed for legitimate businesses. Some industries are not supported.";

export type ContentPolicyResult =
  | { blocked: false }
  | { blocked: true; reason: string };

/**
 * Check the user-supplied business type + description against the blocked
 * categories. Pure, synchronous, no external calls — safe to use in server
 * actions and form-validation paths.
 */
export function checkContentPolicy(input: {
  businessType: string;
  businessDescription: string;
}): ContentPolicyResult {
  // Concatenate-then-lowercase once, rather than lowercasing each keyword
  // per match. Both fields can carry signal (e.g. `businessType` says "Other"
  // but description says "wine bar").
  const haystack = `${input.businessType} ${input.businessDescription}`.toLowerCase();

  for (const { keywords } of BLOCKED_KEYWORDS) {
    for (const keyword of keywords) {
      if (haystack.includes(keyword)) {
        return { blocked: true, reason: BLOCK_REASON };
      }
    }
  }

  return { blocked: false };
}
