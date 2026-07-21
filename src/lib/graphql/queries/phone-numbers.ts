export const PHONE_NUMBERS_PAGE_QUERY = `
  query PhoneNumbersPage($filter: PhoneNumberFilter, $sort: PhoneNumberSort) {
    phoneNumbers {
      list(filter: $filter, sort: $sort) {
        id
        number
        label
        provider
        status
        inboundAgentId
        outboundAgentId
        inboundAgent {
          id
          name
        }
        outboundAgent {
          id
          name
        }
        inboundCallsCount
        outboundCallsCount
        lastActivityAt
        createdAt
        updatedAt
      }
    }
  }
`;

export const PHONE_NUMBERS_CONNECTION_QUERY = `
  query PhoneNumbersConnection(
    $first: Int
    $after: String
    $filter: PhoneNumberFilter
    $sort: PhoneNumberSort
  ) {
    phoneNumbers {
      connection(first: $first, after: $after, filter: $filter, sort: $sort) {
        edges {
          node {
            id
            number
            label
            provider
            status
            inboundAgentId
            outboundAgentId
            inboundAgent {
              id
              name
            }
            outboundAgent {
              id
              name
            }
            inboundCallsCount
            outboundCallsCount
            lastActivityAt
            createdAt
            updatedAt
          }
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

export const PHONE_NUMBER_DETAIL_QUERY = `
  query PhoneNumberDetail($id: ID!, $after: String) {
    phoneNumbers {
      byId(id: $id) {
        id
        number
        label
        provider
        status
        inboundAgentId
        outboundAgentId
        inboundAgent {
          id
          name
        }
        outboundAgent {
          id
          name
        }
        inboundCallsCount
        outboundCallsCount
        lastActivityAt
        createdAt
        updatedAt
      }
    }
    callLogs {
      connection(first: 20, after: $after, filter: { phoneNumberId: $id }) {
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
            aiAgent {
              id
              name
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

export const CREATE_PHONE_NUMBER_MUTATION = `
  mutation CreatePhoneNumber($input: CreatePhoneNumberInput!) {
    phoneNumbers {
      create(input: $input) {
        id
        number
        provider
        status
        inboundAgentId
        outboundAgentId
        inboundCallsCount
        outboundCallsCount
        createdAt
        updatedAt
        inboundAgent { id name }
        outboundAgent { id name }
      }
    }
  }
`;

export const UPDATE_PHONE_NUMBER_MUTATION = `
  mutation UpdatePhoneNumber($id: ID!, $input: UpdatePhoneNumberInput!) {
    phoneNumbers {
      update(id: $id, input: $input) {
        id
        status
        inboundAgentId
        outboundAgentId
        updatedAt
        inboundAgent { id name }
        outboundAgent { id name }
      }
    }
  }
`;
