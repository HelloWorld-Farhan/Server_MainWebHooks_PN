export type CampaignStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED";
export type CampaignDirection = "INBOUND" | "OUTBOUND";

export type ViewerRoleResult = {
  viewer: {
    id: string;
    membershipId: string;
    role: string;
    permissions: string[];
    campaignAccessType: "ALL" | "SELECTED";
    campaignIds: string[];
    company: {
      name: string;
    };
  };
};

export const VIEWER_ROLE_QUERY = `
  query ViewerRole {
    viewer {
      id
      membershipId
      role
      permissions
      campaignAccessType
      campaignIds
      company {
        name
      }
    }
  }
`;

export type ViewerCampaignNameResult = {
  campaigns: {
    byId: {
      name: string;
    } | null;
  };
};

export const VIEWER_CAMPAIGN_NAME_QUERY = `
  query ViewerCampaignName($id: ID!) {
    campaigns {
      byId(id: $id) {
        name
      }
    }
  }
`;

export type CampaignInvitationNode = {
  id: string;
  email: string;
  token: string;
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "CANCELLED";
  createdAt: string;
  updatedAt: string;
  sentAt: string;
  acceptedAt: string | null;
  expiresAt: string;
};

export type CampaignNode = {
  id: string;
  name: string;
  status: CampaignStatus;
  direction: CampaignDirection;
  address: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  customFields: Record<string, unknown> | null;
  aiEnabled: boolean;
  systemPrompt: string | null;
  aiConfig: Record<string, unknown> | null;
  contactsCount: number;
  callLogsCount: number;
  documentsCount: number;
  agentsCount: number;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
  invitationEmailSent: boolean | null;
  invitation: CampaignInvitationNode | null;
  execution?: {
    status:
      | "DRAFT"
      | "SCHEDULED"
      | "RUNNING"
      | "PAUSED"
      | "COMPLETED"
      | "FAILED"
      | "CANCELLED";
    scheduledAt: string | null;
    totalContacts: number;
  } | null;
};

export type CampaignsConnectionResult = {
  campaigns: {
    connection: {
      edges: { node: CampaignNode; cursor: string }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      totalCount: number;
    };
  };
};

export type CampaignContactNode = {
  id: string;
  phone: string | null;
  field1: string | null;
  field2: string | null;
  field3: string | null;
  createdAt: string | null;
};

export type CampaignCallLogNode = {
  id: string;
  direction: string;
  status: string;
  durationSeconds: number;
  startedAt: string;
  leadPhone: string | null;
  leadName: string | null;
};

export type CampaignDocumentNode = {
  id: string;
  name: string;
  url: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
};

export type CampaignActivityNode = {
  id: string;
  type: string;
  summary: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type CampaignAgentNode = {
  id: string;
  name: string;
  type: string;
  category: string | null;
  status: string;
  environment: string;
  enabled: boolean;
  demoAudioUrl: string | null;
  campaignId: string | null;
  systemPrompt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CampaignDetailResult = {
  campaigns: {
    byId: CampaignNode | null;
    activities: CampaignActivityNode[];
  };
};

const BRANCH_FIELDS = `
  id
  name
  status
  direction
  address
  phone
  email
  notes
  customFields
  aiEnabled
  systemPrompt
  aiConfig
  contactsCount
  callLogsCount
  documentsCount
  agentsCount
  lastActivityAt
  createdAt
  updatedAt
  invitationEmailSent
  execution {
    status
    scheduledAt
    totalContacts
  }
  invitation {
    id
    email
    token
    status
    createdAt
    updatedAt
    sentAt
    acceptedAt
    expiresAt
  }
`;

export const BRANCHES_PAGE_QUERY = `
  query CampaignsPage($first: Int, $after: String, $filter: CampaignFilter) {
    campaigns {
      connection(first: $first, after: $after, filter: $filter) {
        edges {
          node {${BRANCH_FIELDS}}
          cursor
        }
        pageInfo {
          hasNextPage
          endCursor
        }
        totalCount
      }
    }
  }
`;

export const CAMPAIGN_DETAIL_QUERY = `
  query CampaignDetail($id: ID!) {
    campaigns {
      byId(id: $id) {${BRANCH_FIELDS}}
      activities(campaignId: $id, limit: 50) {
        id
        type
        summary
        metadata
        createdAt
      }
    }
  }
`;

export const CAMPAIGN_CONTACTS_QUERY = `
  query CampaignContacts($campaignId: ID!, $first: Int, $after: String) {
    campaigns {
      contacts(campaignId: $campaignId, first: $first, after: $after) {
        id
        phone
        field1
        field2
        field3
        createdAt
      }
    }
  }
`;

export const CAMPAIGN_CALL_LOGS_QUERY = `
  query CampaignCallLogs($campaignId: ID!, $first: Int, $after: String) {
    campaigns {
      callLogs(campaignId: $campaignId, first: $first, after: $after) {
        id
        direction
        status
        durationSeconds
        startedAt
        leadPhone
        leadName
      }
    }
  }
`;

export const CAMPAIGN_DOCUMENTS_QUERY = `
  query CampaignDocuments($campaignId: ID!) {
    campaigns {
      documents(campaignId: $campaignId) {
        id
        name
        url
        mimeType
        sizeBytes
        createdAt
      }
    }
  }
`;

export const CAMPAIGN_AGENTS_QUERY = `
  query CampaignAgents($campaignId: ID!) {
    campaigns {
      agents(campaignId: $campaignId) {
        id
        name
        type
        category
        status
        environment
        enabled
        demoAudioUrl
        campaignId
        systemPrompt
        createdAt
        updatedAt
      }
    }
  }
`;

export const CREATE_BRANCH_MUTATION = `
  mutation CreateCampaign($input: CreateCampaignInput!) {
    campaigns {
      create(input: $input) {${BRANCH_FIELDS}}
    }
  }
`;

export const UPDATE_BRANCH_MUTATION = `
  mutation UpdateCampaign($id: ID!, $input: UpdateCampaignInput!) {
    campaigns {
      update(id: $id, input: $input) {${BRANCH_FIELDS}}
    }
  }
`;

export const UPDATE_BRANCH_AI_MUTATION = `
  mutation UpdateCampaignAi($id: ID!, $input: UpdateCampaignAiInput!) {
    campaigns {
      updateAi(id: $id, input: $input) {${BRANCH_FIELDS}}
    }
  }
`;

export const BULK_UPDATE_BRANCHES_MUTATION = `
  mutation BulkUpdateCampaigns($input: BulkCampaignUpdateInput!) {
    campaigns {
      bulkUpdate(input: $input) {
        updated
      }
    }
  }
`;

export const ARCHIVE_BRANCH_MUTATION = `
  mutation ArchiveCampaign($id: ID!) {
    campaigns {
      archive(id: $id) {${BRANCH_FIELDS}}
    }
  }
`;

export const RESEND_BRANCH_INVITATION_MUTATION = `
  mutation ResendCampaignInvitation($campaignId: ID!) {
    campaigns {
      resendInvitation(campaignId: $campaignId) {${BRANCH_FIELDS}}
    }
  }
`;

export const CANCEL_BRANCH_INVITATION_MUTATION = `
  mutation CancelCampaignInvitation($campaignId: ID!) {
    campaigns {
      cancelInvitation(campaignId: $campaignId) {${BRANCH_FIELDS}}
    }
  }
`;

export const GENERATE_NEW_BRANCH_INVITATION_MUTATION = `
  mutation GenerateNewCampaignInvitation($campaignId: ID!) {
    campaigns {
      generateNewInvitation(campaignId: $campaignId) {${BRANCH_FIELDS}}
    }
  }
`;
