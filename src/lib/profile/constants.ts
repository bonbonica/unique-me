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
  "Other",
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];
