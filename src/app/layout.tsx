import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import "./globals.css";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import type { Metadata } from "next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  style: ["normal", "italic"],
  axes: ["opsz", "SOFT", "WONK"],
});

// Shared product description — kept in one constant so metadata, OG, Twitter,
// and the JSON-LD payload never drift out of sync.
const productDescription =
  "AI social-media post generator and auto-poster for business owners. Tell us about your business, answer two weekly questions, and we'll create and schedule a week of posts to Facebook, Instagram, and LinkedIn.";

const productSocialTitle =
  "UniqueMe — AI social-media posts for your business";

export const metadata: Metadata = {
  title: {
    default: "UniqueMe",
    template: "%s | UniqueMe",
  },
  description: productDescription,
  keywords: [
    "UniqueMe",
    "AI",
    "Social Media",
    "Content Generation",
    "Small Business",
    "Marketing Automation",
    "Facebook",
    "Instagram",
    "LinkedIn",
  ],
  authors: [{ name: "UniqueMe" }],
  creator: "UniqueMe",
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "UniqueMe",
    title: productSocialTitle,
    description: productDescription,
  },
  twitter: {
    card: "summary_large_image",
    title: productSocialTitle,
    description: productDescription,
  },
  robots: {
    index: true,
    follow: true,
  },
};

// JSON-LD structured data for SEO. UniqueMe is a marketing/business
// application, not a developer tool — keep applicationCategory aligned.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "UniqueMe",
  description: productDescription,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Any",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  author: {
    "@type": "Person",
    name: "UniqueMe",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} antialiased min-h-screen flex flex-col`}
      >
        {/*
          UniqueMe is dark-only by design (DESIGN.md § 2). We pin next-themes
          to "dark" via forcedTheme so any stray client toggle or system
          preference cannot escape the Midnight + Champagne palette.
        */}
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          forcedTheme="dark"
          disableTransitionOnChange
        >
          <SiteHeader />
          <main id="main-content" className="flex-1">{children}</main>
          <SiteFooter />
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
