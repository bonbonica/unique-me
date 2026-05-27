import Link from "next/link";
import {
  Calendar,
  Check,
  Heart,
  Image as ImageIcon,
  MessageCircle,
  Send,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const previewDays = [
  { day: "Monday", Icon: ImageIcon },
  { day: "Tuesday", Icon: Sparkles },
  { day: "Wednesday", Icon: Calendar },
  { day: "Thursday", Icon: Send },
  { day: "Friday", Icon: Heart },
  { day: "Saturday", Icon: MessageCircle },
  { day: "Sunday", Icon: TrendingUp },
];

const steps = [
  {
    number: 1,
    title: "Tell us about your business",
    copy: "A few quick questions about who you are, what you sell, and the voice you want to use. Two minutes, once.",
  },
  {
    number: 2,
    title: "Pick your weekly theme",
    copy: "Answer two short prompts each week. Your theme drives all seven posts.",
  },
  {
    number: 3,
    title: "We handle the rest",
    copy: "Seven posts, written and illustrated to your brand, scheduled and published to Facebook, Instagram, and LinkedIn.",
  },
];

type Plan = {
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  features: string[];
  cta: string;
  featured: boolean;
};

const plans: Plan[] = [
  {
    name: "Free Trial",
    price: "$0",
    cadence: "for 7 days",
    tagline: "Test-drive a full week of posts.",
    features: [
      "7 days of posts",
      "All 3 platforms (Facebook, Instagram, LinkedIn)",
      "AI-generated images",
      "Cancel anytime",
    ],
    cta: "Start Free Trial",
    featured: false,
  },
  {
    name: "Starter",
    price: "$9.99",
    cadence: "per month",
    tagline: "One brand, fully scheduled.",
    features: [
      "Everything in Free Trial",
      "Unlimited weekly posts",
      "Edit and approve before publishing",
      "Email support",
    ],
    cta: "Choose Starter",
    featured: false,
  },
  {
    name: "Pro",
    price: "$19.99",
    cadence: "per month",
    tagline: "For owners who want it polished.",
    features: [
      "Everything in Starter",
      "Custom brand voice training",
      "Priority image generation",
      "Engagement analytics",
      "Priority support",
    ],
    cta: "Start with Pro",
    featured: true,
  },
];

export default function Home() {
  return (
    <>
      <section className="py-20 sm:py-28 lg:py-36">
        <div className="container mx-auto px-5 sm:px-8 lg:px-12 max-w-6xl">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12 lg:gap-16 items-center">
            <div className="md:col-span-7 order-last md:order-first animate-fade-up">
              <h1 className="font-fraunces font-medium text-4xl sm:text-5xl md:text-6xl lg:text-7xl tracking-tight leading-[1.05]">
                Your Week of Social Media —{" "}
                <span className="gilt">Done in 5 Minutes</span>
              </h1>
              <p className="mt-6 text-lg sm:text-xl text-muted-foreground leading-8 max-w-xl">
                Tell us your theme. Get 7 posts with images. Scheduled and
                posted automatically to Facebook, Instagram, and LinkedIn.
              </p>
              <Button
                asChild
                size="lg"
                className="rounded-full glow-champagne mt-10"
              >
                <Link href="/login">
                  Start Free Trial — No Credit Card
                </Link>
              </Button>
              <p className="mt-4 text-sm text-muted-foreground">
                7 days free. Cancel anytime. No credit card required.
              </p>
            </div>

            <div className="md:col-span-5 order-first md:order-last animate-fade-in">
              <div className="bg-card rounded-2xl p-8 shadow-float border border-border">
                <h2 className="font-fraunces text-xl font-medium tracking-tight mb-6">
                  This week&rsquo;s posts
                </h2>
                <ul className="space-y-3">
                  {previewDays.map(({ day, Icon }) => (
                    <li
                      key={day}
                      className="bg-muted rounded-lg px-4 py-3 flex items-center gap-3"
                    >
                      <span className="size-9 rounded-lg bg-gradient-to-br from-primary/20 to-accent/10 border border-primary/30 flex items-center justify-center shrink-0">
                        <Icon className="size-4 text-primary" />
                      </span>
                      <span className="flex-1 text-sm font-medium">{day}</span>
                      <span className="text-primary text-xs">Scheduled</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-12 sm:py-16 lg:py-24">
        <div className="container mx-auto px-5 sm:px-8 lg:px-12 max-w-5xl">
          <p className="text-sm font-medium tracking-wider uppercase text-primary mb-3 text-center">
            Three steps
          </p>
          <h2 className="font-fraunces text-3xl sm:text-4xl font-medium tracking-tight text-center">
            How it works
          </h2>
          <p className="mt-4 text-lg text-muted-foreground text-center max-w-2xl mx-auto leading-8">
            From &ldquo;what should I post?&rdquo; to a full week scheduled —
            without you touching it again.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 mt-16">
            {steps.map(({ number, title, copy }) => (
              <div
                key={number}
                className="bg-card rounded-2xl p-8 shadow-soft border border-border space-y-4 card-interactive"
              >
                <span className="size-10 rounded-full bg-gradient-to-br from-primary/20 to-accent/10 border border-primary/30 flex items-center justify-center">
                  <span className="font-fraunces text-lg font-medium text-primary">
                    {number}
                  </span>
                </span>
                <h3 className="font-fraunces text-xl font-medium tracking-tight">
                  {title}
                </h3>
                <p className="text-base text-muted-foreground leading-7">
                  {copy}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-12 sm:py-16 lg:py-24">
        <div className="container mx-auto px-5 sm:px-8 lg:px-12 max-w-6xl">
          <p className="text-sm font-medium tracking-wider uppercase text-primary mb-3 text-center">
            Pricing
          </p>
          <h2 className="font-fraunces text-3xl sm:text-4xl font-medium tracking-tight text-center">
            Built for small businesses.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground text-center max-w-2xl mx-auto leading-8">
            One simple price. Cancel anytime from your dashboard.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 mt-16 items-stretch">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={
                  plan.featured
                    ? "bg-card rounded-2xl p-8 shadow-lift border border-primary/40 flex flex-col space-y-6 relative"
                    : "bg-card rounded-2xl p-8 shadow-soft border border-border flex flex-col space-y-6"
                }
              >
                {plan.featured ? (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full bg-primary/15 text-primary border border-primary/30 px-3 py-1 text-xs font-medium tracking-wide uppercase">
                    <Sparkles className="size-3" />
                    Most Popular
                  </span>
                ) : null}

                <h3 className="font-fraunces text-xl font-medium tracking-tight">
                  {plan.name}
                </h3>

                <div>
                  <div className="font-fraunces text-4xl sm:text-5xl font-medium tracking-tight">
                    {plan.price}
                  </div>
                  <div className="text-muted-foreground text-sm mt-1">
                    {plan.cadence}
                  </div>
                </div>

                <p className="text-base text-muted-foreground leading-7">
                  {plan.tagline}
                </p>

                <ul className="space-y-3 flex-1">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <Check className="size-4 text-primary mt-0.5 shrink-0" />
                      <span className="text-sm text-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  asChild
                  size="lg"
                  variant={plan.featured ? "default" : "secondary"}
                  className="w-full rounded-full"
                >
                  <Link href="/login">{plan.cta}</Link>
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-20 lg:py-24">
        <div className="container mx-auto px-5 sm:px-8 lg:px-12">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="font-fraunces text-3xl sm:text-4xl font-medium tracking-tight">
              Stop wondering what to post.
            </h2>
            <p className="mt-4 text-lg text-muted-foreground leading-8">
              Your first week takes five minutes. The rest happens on its own.
            </p>
            <Button asChild size="lg" className="rounded-full mt-10">
              <Link href="/login">Begin your free week</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
