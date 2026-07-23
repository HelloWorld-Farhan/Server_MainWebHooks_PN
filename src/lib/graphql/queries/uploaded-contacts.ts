export const UPLOADED_CONTACTS_LIST_QUERY = `
  query UploadedContactsList {
    uploadedContacts {
      list {
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

export const CREATE_UPLOADED_CONTACT_MUTATION = `
  mutation CreateUploadedContact($phone: String!) {
    uploadedContacts {
      create(phone: $phone) {
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

export const IMPORT_UPLOADED_CONTACTS_MUTATION = `
  mutation ImportUploadedContacts($contacts: [ImportedContactInput!]!) {
    uploadedContacts {
      importContacts(contacts: $contacts) {
        created
        updated
        skipped
        invalid
        unmatchedCampaigns
      }
    }
  }
`;

export const DELETE_UPLOADED_CONTACT_MUTATION = `
  mutation DeleteUploadedContact($id: ID!) {
    uploadedContacts {
      delete(id: $id)
    }
  }
`;

export const BULK_DELETE_UPLOADED_CONTACTS_MUTATION = `
  mutation BulkDeleteUploadedContacts($ids: [ID!]!) {
    uploadedContacts {
      bulkDelete(ids: $ids)
    }
  }
`;

export type UploadedContactResult = {
  id: string;
  phone: string;
  field1: string | null;
  field2: string | null;
  field3: string | null;
  createdAt: string;
};

export type ImportedContactInput = {
  phone: string;
  field1?: string | null;
  field2?: string | null;
  field3?: string | null;
  campaignNames?: string[];
  campaignIds?: string[];
};

export type UploadedContactsListResult = {
  uploadedContacts: {
    list: UploadedContactResult[];
  };
};

export type UploadedContactImportResult = {
  uploadedContacts: {
    importContacts: {
      created: number;
      updated: number;
      skipped: number;
      invalid: number;
      unmatchedCampaigns: string[];
    };
  };
};
