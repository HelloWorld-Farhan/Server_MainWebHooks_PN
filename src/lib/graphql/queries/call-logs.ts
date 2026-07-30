export const CALL_LOGS_PAGE_QUERY = `
  query CallLogsPage($after: String, $filter: CallLogFilter) {
    callLogs {
      connection(first: 100, after: $after, filter: $filter) {
        edges {
          node {
            id
            callLogId
            publicId
            direction
            status
            outcome
            startedAt
            durationSeconds
            recordingUrl
            transcriptUrl
            cost
            creditsUsed
            provider
            providerStatus
            disconnectReason
            aiSummary
            sentiment
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

export type CallLogsPageNode = {
  id: string;
  callLogId?: string;
  publicId?: string;
  direction: string;
  status: string;
  outcome: string | null;
  startedAt: string;
  durationSeconds: number;
  recordingUrl: string | null;
  transcriptUrl: string | null;
  cost: number | null;
  creditsUsed: number | null;
  provider: string | null;
  providerStatus?: string | null;
  disconnectReason?: string | null;
  aiSummary: Record<string, unknown> | null;
  sentiment: Record<string, unknown> | null;
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

export type CallLogsPageResult = {
  callLogs: {
    connection: {
      edges: {
        node: CallLogsPageNode;
        cursor: string;
      }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
};
