import {
  Calendar,
  CreditCard,
  HelpCircle,
  Sheet,
  type LucideIcon,
} from "lucide-react";

import type { IntegrationId } from "@/lib/integrations/types";
import type { AgentToolId } from "./types";

export type ToolRegistryEntry = {
  id: AgentToolId;
  name: string;
  description: string;
  icon: LucideIcon;
  requiredIntegrationId?: IntegrationId;
  examples: string[];
};

export const TOOL_REGISTRY: ToolRegistryEntry[] = [
  {
    id: "faq",
    name: "FAQ Tool",
    description:
      "Allow agents to answer customer questions using knowledge sources.",
    icon: HelpCircle,
    examples: [
      "Pricing questions",
      "Company information",
      "Product information",
      "FAQs",
    ],
  },
  {
    id: "billing",
    name: "Billing Tool",
    description:
      "Allow agents to access customer account and billing information.",
    icon: CreditCard,
    examples: [
      "Available credits",
      "Active plan",
      "Invoice status",
      "Payment status",
    ],
  },
  {
    id: "google-calendar",
    name: "Google Calendar Tool",
    description:
      "Allow agents to manage appointments during calls.",
    icon: Calendar,
    requiredIntegrationId: "google-calendar",
    examples: [
      "Check availability",
      "Schedule demos",
      "Reschedule meetings",
      "Cancel appointments",
    ],
  },
  {
    id: "google-sheets",
    name: "Google Sheets Tool",
    description:
      "Allow agents to read and update spreadsheet data during calls.",
    icon: Sheet,
    requiredIntegrationId: "google-sheets",
    examples: [
      "Read customer records",
      "Save call outcomes",
      "Update lead status",
      "Save notes and lead scores",
    ],
  },
];

export function getToolDefinition(
  id: AgentToolId,
): ToolRegistryEntry | undefined {
  return TOOL_REGISTRY.find((t) => t.id === id);
}
