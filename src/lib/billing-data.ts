export type BillingHistoryItem = {
  id: string;
  date: string;
  description: string;
  amount: string;
};

export type CreditPack = {
  id: string;
  credits: number;
  price: number;
  popular?: boolean;
};

export type SubscriptionPlan = {
  id: string;
  name: string;
  price: number;
  period: string;
  description: string;
  credits: number;
  features: string[];
  popular?: boolean;
};

export const billingSummary = {
  availablePercent: 75,
  remainingCredits: 12450,
  totalCredits: 16000,
  usedCredits: 3550,
  resetDate: "Oct 24, 2026",
  activePlan: "Enterprise AI",
  nextInvoiceAmount: "$499.00",
  nextInvoiceDue: "Oct 24, 2026",
};

export const billingHistory: BillingHistoryItem[] = [
  {
    id: "1",
    date: "Sep 24, 2025",
    description: "Enterprise Plan Subscription",
    amount: "$499.00",
  },
  {
    id: "2",
    date: "Aug 24, 2025",
    description: "Enterprise Plan Subscription",
    amount: "$499.00",
  },
  {
    id: "3",
    date: "Jul 18, 2025",
    description: "Extra Credit Pack (5,000)",
    amount: "$99.00",
  },
  {
    id: "4",
    date: "Jun 24, 2025",
    description: "Enterprise Plan Subscription",
    amount: "$499.00",
  },
];

export const creditPacks: CreditPack[] = [
  { id: "pack-1k", credits: 1000, price: 29 },
  { id: "pack-5k", credits: 5000, price: 99, popular: true },
  { id: "pack-16k", credits: 16000, price: 249 },
];

export const subscriptionPlans: SubscriptionPlan[] = [
  {
    id: "starter",
    name: "Starter",
    price: 99,
    period: "month",
    description: "For small teams testing voice automation.",
    credits: 2000,
    features: [
      "2 voice agents",
      "1 phone number",
      "Basic call analytics",
      "Email support",
    ],
  },
  {
    id: "professional",
    name: "Professional",
    price: 249,
    period: "month",
    description: "For growing teams scaling outbound and support calls.",
    credits: 8000,
    features: [
      "10 voice agents",
      "5 phone numbers",
      "Advanced analytics & reviews",
      "Priority support",
      "CSV contact import",
    ],
    popular: true,
  },
  {
    id: "enterprise",
    name: "Enterprise AI",
    price: 499,
    period: "month",
    description: "For high-volume operations with custom workflows.",
    credits: 16000,
    features: [
      "Unlimited voice agents",
      "Unlimited phone numbers",
      "Custom voice cloning",
      "Dedicated account manager",
      "SLA & API access",
    ],
  },
];
