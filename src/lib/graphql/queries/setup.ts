export const SETUP_PAGE_QUERY = `
  query SetupPage {
    integrations {
      list {
        id
        type
        status
        connectedAccount
        lastSyncAt
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
  }
`;

export type SetupPageResult = {
  integrations: {
    list: {
      id: string;
      type: string;
      status: string;
      connectedAccount: string | null;
      lastSyncAt: string | null;
    }[];
  };
  phoneNumbers: {
    list: {
      id: string;
      number: string;
      provider: string;
      status: string;
      inboundAgentId: string | null;
      outboundAgentId: string | null;
    }[];
  };
};
