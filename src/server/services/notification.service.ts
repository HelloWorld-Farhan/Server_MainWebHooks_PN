export class NotificationService {
  private readonly gasUrl = process.env.GOOGLE_APPS_SCRIPT_URL || "";

  async sendSubCompanyCreatedEmail(payload: {
    companyName: string;
    parentCompanyName: string;
    allocatedCredits: number;
    email: string;
  }) {
    if (!this.gasUrl) {
      console.warn("No GOOGLE_APPS_SCRIPT_URL configured. Skipping email notification.");
      return;
    }

    try {
      const response = await fetch(this.gasUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "SUB_COMPANY_CREATED",
          data: payload,
        }),
      });

      if (!response.ok) {
        console.error("Failed to send GAS notification:", await response.text());
      }
    } catch (error) {
      console.error("Error sending GAS notification:", error);
    }
  }

  async sendCreditUpdateEmail(payload: {
    companyName: string;
    amount: number;
    newBalance: number;
    type: "TOP_UP" | "DEDUCTION";
  }) {
    if (!this.gasUrl) {
      console.warn("No GOOGLE_APPS_SCRIPT_URL configured. Skipping credit update email notification.");
      return;
    }

    try {
      const response = await fetch(this.gasUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "CREDIT_UPDATE",
          data: payload,
        }),
      });

      if (!response.ok) {
        console.error("Failed to send GAS notification:", await response.text());
      }
    } catch (error) {
      console.error("Error sending GAS notification:", error);
    }
  }

  async sendCreditZeroWarningEmail(payload: { email: string; name: string }) {
    if (!this.gasUrl) {
      console.warn("No GOOGLE_APPS_SCRIPT_URL configured. Skipping email notification.");
      return;
    }
    try {
      const response = await fetch(this.gasUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "CREDIT_ZERO_WARNING", data: payload }),
      });
      if (!response.ok) {
        console.error("Failed to send zero credit warning:", await response.text());
      }
    } catch (error) {
      console.error("Error sending zero credit warning:", error);
    }
  }

  async sendSubCompanyCreditZeroWarningEmail(payload: { email: string; companyName: string }) {
    if (!this.gasUrl) {
      console.warn("No GOOGLE_APPS_SCRIPT_URL configured. Skipping email notification.");
      return;
    }
    try {
      const response = await fetch(this.gasUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "SUBCOMPANY_CREDIT_ZERO_WARNING", data: payload }),
      });
      if (!response.ok) {
        console.error("Failed to send subcompany zero credit warning:", await response.text());
      }
    } catch (error) {
      console.error("Error sending subcompany zero credit warning:", error);
    }
  }
}

export const notificationService = new NotificationService();
