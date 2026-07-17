export type TelephonyProvider = "twilio" | "exotel" | "propnex";

export type TwilioCredentials = {
  accountSid: string;
  authToken: string;
  defaultPhoneNumber: string;
};

export type ExotelCredentials = {
  apiKey: string;
  apiSecret: string;
  exophoneNumber: string;
};

export type PropNexCredentials = {
  region: string;
  environment: "production" | "sandbox";
};

export type ProviderCredentials = {
  twilio: TwilioCredentials;
  exotel: ExotelCredentials;
  propnex: PropNexCredentials;
};

export type ChannelSettings = {
  maxConcurrentCalls: number;
  callQueueLimit: number;
  overflowHandling: "queue" | "reject" | "forward";
};

export type TelephonySettings = {
  activeProvider: TelephonyProvider | null;
  connectionTested: Partial<Record<TelephonyProvider, boolean>>;
  connectionStatus: Partial<Record<TelephonyProvider, string>>;
  channelSettings: ChannelSettings;
  encryptedCredentials: string | null;
};

export const DEFAULT_CHANNEL_SETTINGS: ChannelSettings = {
  maxConcurrentCalls: 20,
  callQueueLimit: 50,
  overflowHandling: "queue",
};

export const DEFAULT_PROVIDER_CREDENTIALS: ProviderCredentials = {
  twilio: { accountSid: "", authToken: "", defaultPhoneNumber: "" },
  exotel: { apiKey: "", apiSecret: "", exophoneNumber: "" },
  propnex: { region: "us-east-1", environment: "production" },
};
