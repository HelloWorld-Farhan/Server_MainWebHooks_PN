export const LEADS_REACTIVATION_QUERY = `
  query LeadsReactivation($after: String, $filter: LeadFilter) {
    leads {
      connection(first: 50, after: $after, filter: $filter) {
        edges {
          node {
            id
            firstName
            lastName
            email
            phone
            temperature
            score
            lastContactedAt
            sourceName
            stageName
          }
          cursor
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
      temperatureBreakdown {
        hot
        warm
        cold
        total
      }
    }
  }
`;

export type LeadsReactivationResult = {
  leads: {
    connection: {
      edges: {
        node: {
          id: string;
          firstName: string | null;
          lastName: string | null;
          email: string | null;
          phone: string | null;
          temperature: string | null;
          score: number;
          lastContactedAt: string | null;
          sourceName: string | null;
          stageName: string | null;
        };
        cursor: string;
      }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
    temperatureBreakdown: {
      hot: number;
      warm: number;
      cold: number;
      total: number;
    };
  };
};

export const IMPORT_LEADS_MUTATION = `
  mutation ImportLeads($rows: [LeadImportRowInput!]!) {
    leads {
      importRows(rows: $rows) {
        hot
        warm
        cold
        total
        invalid
        created
        updated
      }
    }
  }
`;

export type LeadImportResult = {
  leads: {
    importRows: {
      hot: number;
      warm: number;
      cold: number;
      total: number;
      invalid: number;
      created: number;
      updated: number;
    };
  };
};
