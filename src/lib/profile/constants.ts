export const BUSINESS_TYPES = [
  "Health and Wellness",
  "Restaurant/Food",
  "Real Estate",
  "Retail/Shop",
  "Professional Services",
  "Beauty/Salon",
  "Fitness",
  "Education",
  "Tech",
  "Health",
  "Coaching",
  "Other",
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];
