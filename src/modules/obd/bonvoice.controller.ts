import { Controller, Post, Body } from "@nestjs/common";

@Controller("api/obd/bonvoice")
export class BonvoiceController {
  @Post("add-leads")
  async addLeads(
    @Body()
    body: {
      leads: any[];
      didNumber: string;
      companyId: string;
    }
  ) {
    const { leads, didNumber, companyId } = body;
    const BONVOICE_API_URL = process.env.BONVOICE_BASE_URL || "https://backend.pbx.bonvoice.com";

    // 1. Authenticate
    const loginRes = await fetch(`${BONVOICE_API_URL}/usermanagement/external-auth/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        username: process.env.BONVOICE_USERNAME || "PROP_NEXT",
        password: process.env.BONVOICE_PASSWORD || "PRopne##xt89",
      }),
    });

    if (!loginRes.ok) {
      throw new Error("Failed to authenticate with Bonvoice");
    }

    const loginData = await loginRes.json();
    const token = loginData.token || loginData.access_token || loginData.data?.token || loginData.data?.access_token;

    if (!token) {
      throw new Error("Invalid authentication response from Bonvoice");
    }

    // 2. Send leads to Bonvoice one by one using click2call
    const template_url = process.env.BONVOICE_VOICEBOT_URL || "wss://vineeth-inbound.onrender.com/ws/voice-agent";
    const responses = await Promise.all(
      leads.map(async (lead: any) => {
        try {
          const res = await fetch(`${BONVOICE_API_URL}/click2call/`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json",
              Authorization: `Token ${token}`,
            },
            body: JSON.stringify({
              source_number: didNumber,
              destination_number: lead.phone,
              template_url: template_url,
            }),
          });
          
          if (!res.ok) {
              const text = await res.text();
              throw new Error(`Bonvoice API Error: ${text}`);
          }
          return await res.json();
        } catch (err: any) {
          console.error(`Failed to add lead ${lead.phone}:`, err.message);
          throw err;
        }
      })
    );

    return { success: true, data: responses[0] };
  }
}
