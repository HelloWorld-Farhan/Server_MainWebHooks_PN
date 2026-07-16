export const STANDARD_RATE_PER_MIN = 6;
export const VOLUME_RATE_PER_MIN = 5;
export const VOLUME_TIER_MIN_MINUTES = 30_000;
export const VOLUME_TIER_MAX_MINUTES = 60_000;

export type MinutePricingTier = {
  id: string;
  title: string;
  rangeLabel: string;
  ratePerMin: number | null;
  description: string;
  minMinutes: number;
  maxMinutes: number | null;
};

export const minutePricingTiers: MinutePricingTier[] = [
  {
    id: "standard",
    title: "Standard",
    rangeLabel: "Under 30,000 mins / month",
    ratePerMin: 6,
    description: "For teams getting started with AI voice outreach.",
    minMinutes: 0,
    maxMinutes: VOLUME_TIER_MIN_MINUTES - 1,
  },
  {
    id: "volume",
    title: "Volume",
    rangeLabel: "30,000 – 60,000 mins / month",
    ratePerMin: 5,
    description: "Better rates when your call volume scales up.",
    minMinutes: VOLUME_TIER_MIN_MINUTES,
    maxMinutes: VOLUME_TIER_MAX_MINUTES,
  },
  {
    id: "enterprise",
    title: "Enterprise",
    rangeLabel: "Above 60,000 mins / month",
    ratePerMin: null,
    description: "Custom pricing tailored to your committed usage.",
    minMinutes: VOLUME_TIER_MAX_MINUTES + 1,
    maxMinutes: null,
  },
];

export const monthlyMinutePresets = [
  { label: "10K", minutes: 10_000 },
  { label: "20K", minutes: 20_000 },
  { label: "45K", minutes: 45_000 },
  { label: "75K", minutes: 75_000 },
];

export const pricingPlans = [
  {
    id: "payg",
    title: "Pay-as-you-go",
    subtitle: "Flexible credits, top-up anytime",
    description: "Perfect for ad-hoc use cases:",
    features: [
      "₹6 per minute under 30,000 mins / month",
      "Top-up when balance is low",
      "No commitment",
    ],
    cta: "Get started",
    ctaHref: "/sign-up",
    variant: "outline" as const,
  },
  {
    id: "volume",
    title: "Volume Plan",
    subtitle: "Discounted per-minute pricing",
    description: null,
    features: [
      "₹5 per minute from 30,000 – 60,000 mins / month",
      "Up to 100 concurrent calls",
      "Pre-configured voice agents",
      "Free phone number for first 30 days",
      "Sub-accounts access",
    ],
    cta: "Get started",
    ctaHref: "/sign-up",
    variant: "default" as const,
    highlighted: true,
  },
  {
    id: "enterprise",
    title: "Enterprise Plan",
    subtitle: "Custom scalable plans",
    description: "For usage above 60,000 minutes per month:",
    features: [
      "Custom per-minute pricing",
      "Customised integrations and deployment",
      "Priority support",
      "Dedicated account manager",
    ],
    cta: "Talk to sales",
    ctaHref: "mailto:sales@propnex.ai",
    variant: "outline" as const,
  },
];

export const pricingFaqs = [
  {
    question: "How is per-minute pricing calculated?",
    answer:
      "Pricing depends on your expected monthly call volume. Under 30,000 minutes per month, the rate is ₹6 per minute. Between 30,000 and 60,000 minutes per month, the rate drops to ₹5 per minute. For usage above 60,000 minutes, we offer custom enterprise pricing.",
  },
  {
    question: "How does pay-as-you-go pricing work?",
    answer:
      "With transparent usage-based pricing, you only pay for what you actually consume. Top up credits whenever your balance runs low. Every call is billed based on actual minutes used at the rate that applies to your monthly volume.",
  },
  {
    question: "What happens when I cross 30,000 or 60,000 minutes?",
    answer:
      "Once your monthly usage reaches 30,000 minutes, your rate moves to ₹5 per minute for that billing period. If you consistently exceed 60,000 minutes, our sales team can set up a custom enterprise plan with pricing suited to your volume.",
  },
  {
    question: "What happens if I run out of credits?",
    answer:
      "Your agents will stop making calls when credits run out. You can set up automatic top-ups or receive notifications when your balance is low to ensure uninterrupted service.",
  },
  {
    question: "Do you offer volume discounts?",
    answer:
      "Yes! Usage between 30,000 and 60,000 minutes automatically qualifies for our ₹5 per minute volume rate. For commitments above 60,000 minutes, contact our sales team for custom pricing.",
  },
  {
    question: "Is there a free trial available?",
    answer:
      "Yes! We offer free credits when you sign up so you can test our platform and experience the service firsthand before committing to a larger purchase.",
  },
];

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrFormatterPrecise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatInr(amount: number): string {
  return inrFormatter.format(amount);
}

export function formatRatePerMin(rate: number): string {
  return inrFormatterPrecise.format(rate);
}

export type MinutePricingResult = {
  tier: MinutePricingTier;
  ratePerMin: number | null;
  isCustom: boolean;
  estimatedMonthlyCost: number | null;
};

export function getPricingForMonthlyMinutes(
  minutes: number,
): MinutePricingResult {
  const safeMinutes = Math.max(0, Math.round(minutes));

  if (safeMinutes < VOLUME_TIER_MIN_MINUTES) {
    const tier = minutePricingTiers[0];
    return {
      tier,
      ratePerMin: STANDARD_RATE_PER_MIN,
      isCustom: false,
      estimatedMonthlyCost: safeMinutes * STANDARD_RATE_PER_MIN,
    };
  }

  if (safeMinutes <= VOLUME_TIER_MAX_MINUTES) {
    const tier = minutePricingTiers[1];
    return {
      tier,
      ratePerMin: VOLUME_RATE_PER_MIN,
      isCustom: false,
      estimatedMonthlyCost: safeMinutes * VOLUME_RATE_PER_MIN,
    };
  }

  const tier = minutePricingTiers[2];
  return {
    tier,
    ratePerMin: null,
    isCustom: true,
    estimatedMonthlyCost: null,
  };
}

export function formatMinutes(minutes: number): string {
  return minutes.toLocaleString("en-IN");
}
