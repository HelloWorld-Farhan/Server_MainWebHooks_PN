export const CALL_LOGS_PAGE_QUERY = `
  query CallLogsPage($after: String, $filter: CallLogFilter) {
    callLogs {
      connection(first: 20, after: $after, filter: $filter) {
        edges {
          node {
            id
            startedAt
            aiAgent {
              id
              name
            }
            campaign {
              id
              name
              status
              customFields
              createdAt
              execution {
                status
                scheduledAt
                totalContacts
              }
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
        reactivationPlan
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
        internalNotes {
          id
          content
          createdAt
          updatedAt
          author {
            id
            name
            email
          }
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
          aiAgent: { id: string; name: string } | null;
          campaign: {
            id: string;
            name: string;
            status: string;
            customFields: Record<string, unknown> | null;
            createdAt: string;
            execution: {
              status: string;
              scheduledAt: string | null;
              totalContacts: number;
            } | null;
          } | null;
        };
        cursor: string;
      }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
};
