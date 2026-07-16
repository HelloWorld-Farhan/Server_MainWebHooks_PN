export const SETTINGS_PAGE_QUERY = `
  query SettingsPage {
    viewer {
      id
      email
      firstName
      lastName
      role
      company {
        id
        name
        slug
        contact {
          name
          email
          phone
          title
        }
      }
    }
    integrations {
      list {
        id
        type
        status
        connectedAccount
        lastSyncAt
      }
    }
  }
`;

export type SettingsPageResult = {
  viewer: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
    company: {
      id: string;
      name: string;
      slug: string;
      contact: {
        name: string;
        email: string;
        phone: string | null;
        title: string | null;
      } | null;
    };
  };
  integrations: {
    list: {
      id: string;
      type: string;
      status: string;
      connectedAccount: string | null;
      lastSyncAt: string | null;
    }[];
  };
};
