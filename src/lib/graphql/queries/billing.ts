export const BILLING_PAGE_QUERY = `
  query BillingPage($after: String) {
    billing {
      subscription {
        planName
        status
        currentPeriodEnd
        nextInvoiceAmount
      }
      invoices(first: 20, after: $after) {
        edges {
          node {
            id
            issuedAt
            amountCents
            status
            description
            currency
          }
          cursor
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
    credits {
      usageHistory(first: 20) {
        edges {
          node {
            id
            amount
            reason
            description
            createdAt
          }
          cursor
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

export type BillingPageResult = {
  billing: {
    subscription: {
      planName: string;
      status: string;
      currentPeriodEnd: string;
      nextInvoiceAmount: number | null;
    } | null;
    invoices: {
      edges: {
        node: {
          id: string;
          issuedAt: string;
          amountCents: number;
          status: string;
          description: string | null;
          currency: string;
        };
        cursor: string;
      }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
  credits: {
    usageHistory: {
      edges: {
        node: {
          id: string;
          amount: number;
          reason: string;
          description: string | null;
          createdAt: string;
        };
        cursor: string;
      }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
};
