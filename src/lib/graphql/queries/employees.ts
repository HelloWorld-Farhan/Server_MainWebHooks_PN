export type UserRole =
  | "OWNER"
  | "ADMIN"
  | "MANAGER"
  | "AGENT"
  | "SALES"
  | "SUPPORT";

export type MemberStatus = "ACTIVE" | "INVITED" | "DEACTIVATED" | "REMOVED";

export type BranchAccessType = "ALL" | "SELECTED";

export type EmployeeBranchNode = {
  id: string;
  name: string;
  status: string;
};

export type InvitationDisplayStatus = "PENDING" | "ACCEPTED" | "EXPIRED";

export type EmployeeNode = {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  imageUrl: string | null;
  jobTitle: string | null;
  role: UserRole;
  branchAccessType: BranchAccessType;
  assignedBranches: EmployeeBranchNode[];
  status: MemberStatus;
  invitationStatus: InvitationDisplayStatus;
  lastActiveAt: string | null;
  invitedAt: string | null;
  joinedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EmployeesConnectionResult = {
  employees: {
    connection: {
      edges: { node: EmployeeNode; cursor: string }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      totalCount: number;
    };
  };
};

export type EmployeeDetailResult = {
  employees: {
    byId: EmployeeNode | null;
    permissionsForRole: string[];
  };
};

const EMPLOYEE_FIELDS = `
  id
  userId
  name
  email
  phone
  imageUrl
  jobTitle
  role
  branchAccessType
  assignedBranches {
    id
    name
    status
  }
  status
  invitationStatus
  lastActiveAt
  invitedAt
  joinedAt
  createdAt
  updatedAt
`;

export const EMPLOYEES_PAGE_QUERY = `
  query EmployeesPage($first: Int, $after: String, $filter: EmployeeFilter) {
    employees {
      connection(first: $first, after: $after, filter: $filter) {
        edges {
          node {${EMPLOYEE_FIELDS}}
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

export const EMPLOYEE_DETAIL_QUERY = `
  query EmployeeDetail($id: ID!, $role: UserRole!) {
    employees {
      byId(id: $id) {${EMPLOYEE_FIELDS}}
      permissionsForRole(role: $role)
    }
  }
`;

export const INVITE_EMPLOYEE_MUTATION = `
  mutation InviteEmployee($input: InviteEmployeeInput!) {
    employees {
      invite(input: $input) {${EMPLOYEE_FIELDS}}
    }
  }
`;

export const UPDATE_EMPLOYEE_MUTATION = `
  mutation UpdateEmployee($id: ID!, $input: UpdateEmployeeInput!) {
    employees {
      update(id: $id, input: $input) {${EMPLOYEE_FIELDS}}
    }
  }
`;

export const DEACTIVATE_EMPLOYEE_MUTATION = `
  mutation DeactivateEmployee($id: ID!) {
    employees {
      deactivate(id: $id) {${EMPLOYEE_FIELDS}}
    }
  }
`;

export const DELETE_EMPLOYEE_MUTATION = `
  mutation DeleteEmployee($id: ID!) {
    employees {
      delete(id: $id)
    }
  }
`;

export const RESEND_EMPLOYEE_INVITE_MUTATION = `
  mutation ResendEmployeeInvite($id: ID!) {
    employees {
      resendInvite(id: $id) {${EMPLOYEE_FIELDS}}
    }
  }
`;

export const CANCEL_EMPLOYEE_INVITE_MUTATION = `
  mutation CancelEmployeeInvite($id: ID!) {
    employees {
      cancelInvite(id: $id)
    }
  }
`;
