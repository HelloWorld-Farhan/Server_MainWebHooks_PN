export const CREDITS_SUMMARY_QUERY = `
  query CreditsSummary {
    credits {
      summary {
        remaining
        used
        total
        availablePercent
        renewalAt
        planId
      }
    }
  }
`;

export type CreditsSummaryResult = {
  credits: {
    summary: {
      remaining: number;
      used: number;
      total: number;
      availablePercent: number;
      renewalAt: string | null;
      planId: string | null;
    };
  };
};
