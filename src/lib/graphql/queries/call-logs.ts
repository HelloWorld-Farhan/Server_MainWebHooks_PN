export const CALL_LOGS_PAGE_QUERY = `
  query CallLogsPage($after: String, $filter: CallLogFilter) {
    callLogs {
      connection(first: 20, after: $after, filter: $filter) {
        edges {
          node {
            id
            startedAt
            direction
            status
            outcome
            durationSeconds
            recordingUrl
            transcriptUrl
            cost
            creditsUsed
            provider
            aiSummary
            sentiment
            leadId
            aiAgentId
            phoneNumberId
            lead {
              id
              firstName
              lastName
              phone
              temperature
              score
            }
            aiAgent {
              id
              name
            }
            phoneNumber {
              id
              number
              label
            }
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

export const CALL_DETAIL_QUERY = `
  query CallDetail($id: ID!) {
    callLogs {
      detail(id: $id) {
        id
        direction
        status
        outcome
        startedAt
        durationSeconds
        recordingUrl
        cost
        creditsUsed
        provider
        aiSummary
        sentiment
        engagement
        lead {
          id
          firstName
          lastName
          phone
          temperature
          score
        }
        aiAgent {
          id
          name
        }
        phoneNumber {
          id
          number
          label
        }
        transcript {
          id
          fullText
          segments
        }
      }
    }
  }
`;

export type CallLogsPageResult = {
  callLogs: {
    connection: {
      edges: {
        node: {
          id: string;
          startedAt: string;
          direction: string;
          status: string;
          outcome: string | null;
          durationSeconds: number;
          recordingUrl: string | null;
          transcriptUrl: string | null;
          cost: number | null;
          creditsUsed: number | null;
          provider: string | null;
          aiSummary: Record<string, unknown> | null;
          sentiment: Record<string, unknown> | null;
          leadId: string | null;
          aiAgentId: string | null;
          phoneNumberId: string | null;
          lead: {
            id: string;
            firstName: string | null;
            lastName: string | null;
            phone: string | null;
            temperature: string | null;
            score: number;
          } | null;
          aiAgent: { id: string; name: string } | null;
          phoneNumber: {
            id: string;
            number: string;
            label: string | null;
          } | null;
        };
        cursor: string;
      }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
};
