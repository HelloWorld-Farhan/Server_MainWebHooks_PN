export const HOME_PAGE_QUERY = `
  query HomePage($dateFrom: String, $dateTo: String) {
    callLogs {
      recent(limit: 10) {
        id
        startedAt
        direction
        status
        durationSeconds
        lead {
          firstName
          lastName
        }
      }
    }
    analytics {
      summary(granularity: DAILY, dateFrom: $dateFrom, dateTo: $dateTo) {
        totalCalls
        connectedCalls
        conversionRate
      }
    }
    agents {
      statusSummary {
        active
        inactive
        total
      }
    }
    leads {
      temperatureBreakdown {
        hot
        warm
        cold
        total
      }
    }
    scheduler {
      upcoming(limit: 5) {
        id
        type
        title
        startAt
        status
      }
    }
    events {
      recent(limit: 10) {
        id
        type
        title
        entityType
        entityId
        createdAt
      }
    }
  }
`;

export type HomePageResult = {
  callLogs: {
    recent: {
      id: string;
      startedAt: string;
      direction: string;
      status: string;
      durationSeconds: number;
      lead: { firstName: string | null; lastName: string | null } | null;
    }[];
  };
  analytics: {
    summary: {
      totalCalls: number;
      connectedCalls: number;
      conversionRate: number;
    };
  };
  agents: {
    statusSummary: { active: number; inactive: number; total: number };
  };
  leads: {
    temperatureBreakdown: {
      hot: number;
      warm: number;
      cold: number;
      total: number;
    };
  };
  scheduler: {
    upcoming: {
      id: string;
      type: string;
      title: string;
      startAt: string;
      status: string;
    }[];
  };
  events: {
    recent: {
      id: string;
      type: string;
      title: string;
      entityType: string | null;
      entityId: string | null;
      createdAt: string;
    }[];
  };
};

export const BRANCH_DASHBOARD_QUERY = `
  query BranchDashboard($branchId: ID!, $dateFrom: String, $dateTo: String) {
    branches {
      byId(id: $branchId) {
        id
        name
        status
        aiEnabled
        lastActivityAt
      }
    }
    callLogs {
      recent(limit: 10) {
        id
        startedAt
        direction
        status
        durationSeconds
        lead {
          firstName
          lastName
        }
      }
    }
    analytics {
      summary(granularity: DAILY, dateFrom: $dateFrom, dateTo: $dateTo) {
        totalCalls
        connectedCalls
        conversionRate
      }
    }
    leads {
      temperatureBreakdown {
        hot
        warm
        cold
        total
      }
    }
  }
`;

export type BranchDashboardResult = {
  branches: {
    byId: {
      id: string;
      name: string;
      status: string;
      aiEnabled: boolean;
      lastActivityAt: string | null;
    } | null;
  };
  callLogs: {
    recent: {
      id: string;
      startedAt: string;
      direction: string;
      status: string;
      durationSeconds: number;
      lead: { firstName: string | null; lastName: string | null } | null;
    }[];
  };
  analytics: {
    summary: {
      totalCalls: number;
      connectedCalls: number;
      conversionRate: number;
    };
  };
  leads: {
    temperatureBreakdown: {
      hot: number;
      warm: number;
      cold: number;
      total: number;
    };
  };
};
