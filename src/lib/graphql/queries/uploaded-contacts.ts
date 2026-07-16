export const UPLOADED_CONTACTS_LIST_QUERY = `
  query UploadedContactsList {
    uploadedContacts {
      list {
        id
        phone
        name
        email
        address
        branches {
          id
          name
        }
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
        name
        email
        address
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
        skipped
        invalid
        unmatchedBranches
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
  name: string | null;
  email: string | null;
  address: string | null;
  branches: { id: string; name: string }[];
  createdAt: string;
};

export type ImportedContactInput = {
  phone: string;
  name?: string | null;
  email?: string | null;
  address?: string | null;
  branchNames?: string[];
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
      skipped: number;
      invalid: number;
      unmatchedBranches: string[];
    };
  };
};
