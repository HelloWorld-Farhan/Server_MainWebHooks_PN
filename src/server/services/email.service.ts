import nodemailer from "nodemailer";

export class EmailService {
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (host && port) {
      this.transporter = nodemailer.createTransport({
        host,
        port: parseInt(port, 10),
        auth: user && pass ? { user, pass } : undefined,
        secure: port === "465",
      });
    }
  }

  async sendEmail(options: { to: string; subject: string; html: string }): Promise<boolean> {
    try {
      if (this.transporter) {
        await this.transporter.sendMail({
          from: process.env.SMTP_FROM || '"PropNex AI" <noreply@propnex.ai>',
          to: options.to,
          subject: options.subject,
          html: options.html,
        });
        return true;
      } else {
        console.log("=========================================");
        console.log(`[Email Service Mock] Sending email to: ${options.to}`);
        console.log(`Subject: ${options.subject}`);
        console.log(`Body:\n${options.html}`);
        console.log("=========================================");
        return true; // Mock send is treated as successful delivery in dev
      }
    } catch (err) {
      console.error("[Email Service Error] Failed to send email:", err);
      return false;
    }
  }
}

export const emailService = new EmailService();
