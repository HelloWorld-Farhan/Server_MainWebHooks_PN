/** Excel template column labels for uploaded contact fields. */
export const CONTACT_PHONE_FIELD_LABELS = {
  field1: "user_name",
  field2: "Recording URL",
  field3: "Transcripts",
} as const;

export type ContactPhoneFieldKey = keyof typeof CONTACT_PHONE_FIELD_LABELS;
