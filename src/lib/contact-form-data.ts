import { pricingPlans } from "@/lib/public-pricing-data";
import type { SupportRequestReason } from "@prisma/client";

export const CONTACT_REASON_OPTIONS: {
  value: SupportRequestReason;
  label: string;
}[] = [
  { value: "GENERAL_INQUIRY", label: "General inquiry" },
  { value: "SALES_PRICING", label: "Sales / pricing question" },
  { value: "TECHNICAL_SUPPORT", label: "Technical support" },
  { value: "BILLING_CREDITS", label: "Purchase credits" },
  { value: "BILLING_CHANNELS", label: "Purchase channels" },
  { value: "ENTERPRISE_PLAN", label: "Enterprise plan" },
  { value: "ACCOUNT_ACCESS", label: "Account / access issue" },
  { value: "OTHER", label: "Other" },
];

export const CONTACT_PLAN_OPTIONS = [
  ...pricingPlans.map((plan) => ({
    id: plan.id,
    label: plan.title,
  })),
  { id: "not_sure", label: "Not sure yet" },
];

export function getContactPlanLabel(planId: string): string {
  return (
    CONTACT_PLAN_OPTIONS.find((option) => option.id === planId)?.label ?? planId
  );
}

export function parseContactIntentReason(
  intent: string | null,
): SupportRequestReason | null {
  if (intent === "credits") return "BILLING_CREDITS";
  if (intent === "channels") return "BILLING_CHANNELS";
  return null;
}

export function parseContactPlanId(plan: string | null): string | null {
  if (!plan) return null;
  const match = CONTACT_PLAN_OPTIONS.find((option) => option.id === plan);
  return match ? match.id : null;
}
