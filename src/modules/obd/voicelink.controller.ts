import { Controller, Post, Body } from "@nestjs/common";

@Controller("api/obd/voicelink")
export class VoicelinkController {
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
    const VOICELINK_API_URL = "https://app.voicelink.co.in/api";

    // 1. Authenticate
    const loginRes = await fetch(`${VOICELINK_API_URL}/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        username: "propnex",
        password: "PropnexAi2025@#",
      }),
    });

    if (!loginRes.ok) {
      throw new Error("Failed to authenticate with Voicelink");
    }

    const loginData = await loginRes.json();
    const token = loginData.data?.access_token || loginData.access_token;

    if (!token) {
      throw new Error("Invalid authentication response from Voicelink");
    }

    // 2. Send leads to Voicelink one by one using the exact working payload
    const responses = await Promise.all(
      leads.map(async (lead: any) => {
        try {
          const res = await fetch(`${VOICELINK_API_URL}/v1/add_lead`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              did_number: didNumber,
              customer_number: lead.phone,
              country_code: "91",
              custom_parameters: JSON.stringify({ name: lead.name, companyId }),
            }),
          });
          
          if (!res.ok) {
              const text = await res.text();
              throw new Error(`Voicelink API Error: ${text}`);
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
