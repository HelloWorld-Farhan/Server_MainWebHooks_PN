import {
  Calendar,
  Mail,
  MessageCircle,
  Sheet,
  type LucideIcon,
} from "lucide-react";

import type { IntegrationId } from "./types";

export type IntegrationDefinition = {
  id: IntegrationId;
  name: string;
  description: string;
  icon: LucideIcon;
  available: boolean;
  comingSoon?: boolean;
};

export const INTEGRATION_DEFINITIONS: IntegrationDefinition[] = [
  {
    id: "google-sheets",
    name: "Google Sheets",
    description:
      "Connect spreadsheets for lead data sync. Agents can read and update records during calls.",
    icon: Sheet,
    available: true,
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description:
      "Connect Google Calendar for appointment scheduling. Agents can check availability and book meetings.",
    icon: Calendar,
    available: true,
  },
  {
    id: "hubspot",
    name: "HubSpot CRM",
    description: "Sync leads and call outcomes with HubSpot CRM.",
    icon: Sheet,
    available: false,
    comingSoon: true,
  },
  {
    id: "salesforce",
    name: "Salesforce",
    description: "Connect Salesforce for enterprise CRM integration.",
    icon: Sheet,
    available: false,
    comingSoon: true,
  },
  {
    id: "email",
    name: "Email",
    description: "Send follow-up emails after calls via Gmail or Outlook.",
    icon: Mail,
    available: false,
    comingSoon: true,
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    description: "Send WhatsApp messages and notifications to leads.",
    icon: MessageCircle,
    available: false,
    comingSoon: true,
  },
];

export function getIntegrationDefinition(
  id: IntegrationId,
): IntegrationDefinition | undefined {
  return INTEGRATION_DEFINITIONS.find((d) => d.id === id);
}
