export const AGENTS_LIST_QUERY = `
  query AgentsList {
    agents {
      statusSummary {
        active
        inactive
        total
      }
      list {
        id
        name
        type
        category
        status
        environment
        enabled
        languages
        demoAudioUrl
        branchId
        createdAt
        updatedAt
      }
    }
  }
`;

export const AGENT_DETAIL_QUERY = `
  query AgentDetail($id: ID!) {
    agents {
      byId(id: $id) {
        id
        name
        type
        category
        status
        environment
        enabled
        languages
        firstMessage
        systemPrompt
        voiceConfig
        modelConfig
        transcriberConfig
        serverConfig
        structuredOutputs
        scorecards
        monitors
        demoAudioUrl
        createdAt
        updatedAt
      }
    }
  }
`;

export const AGENT_DETAIL_PAGE_QUERY = `
  query AgentDetailPage($id: ID!) {
    agents {
      byId(id: $id) {
        id
        name
        type
        category
        status
        environment
        enabled
        languages
        firstMessage
        systemPrompt
        voiceConfig
        modelConfig
        transcriberConfig
        serverConfig
        structuredOutputs
        scorecards
        monitors
        demoAudioUrl
        createdAt
        updatedAt
      }
    }
    phoneNumbers {
      list {
        id
        number
        provider
        status
        inboundAgentId
        outboundAgentId
      }
    }
    callLogs {
      connection(first: 20, filter: { aiAgentId: $id }) {
        edges {
          node {
            id
            startedAt
            direction
            status
            durationSeconds
            lead {
              id
              firstName
              lastName
            }
          }
        }
      }
    }
  }
`;

export const CREATE_AGENT_MUTATION = `
  mutation CreateAgent($input: CreateAgentInput!) {
    agents {
      create(input: $input) {
        id
        name
        type
        category
        status
        environment
        enabled
        languages
        demoAudioUrl
        createdAt
        updatedAt
      }
    }
  }
`;

export const UPDATE_AGENT_MUTATION = `
  mutation UpdateAgent($id: ID!, $input: UpdateAgentInput!) {
    agents {
      update(id: $id, input: $input) {
        id
        name
        type
        category
        status
        environment
        enabled
        languages
        firstMessage
        systemPrompt
        voiceConfig
        modelConfig
        transcriberConfig
        serverConfig
        structuredOutputs
        scorecards
        monitors
        demoAudioUrl
        createdAt
        updatedAt
      }
    }
  }
`;

export type AgentsListResult = {
  agents: {
    statusSummary: { active: number; inactive: number; total: number };
    list: Record<string, unknown>[];
  };
};
