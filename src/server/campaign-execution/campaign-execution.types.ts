import type { CampaignExecutionStatus } from "@prisma/client";

export type CampaignExecutionRow = {
  id: string;
  companyId: string;
  campaignId: string;
  status: CampaignExecutionStatus;
  scheduledAt: Date | null;
  startedAt: Date | null;
  pausedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  cancelledAt: Date | null;
  lastProcessedContactId: string | null;
  processedCount: number;
  totalContacts: number;
  workerId: string | null;
  lockExpiresAt: Date | null;
  correlationId: string | null;
  failureReason: string | null;
  statsQueued: number;
  statsDialing: number;
  statsAnswered: number;
  statsBusy: number;
  statsNoAnswer: number;
  statsFailed: number;
  statsCompleted: number;
  estimatedCompletionAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CampaignExecutionStatistics = {
  totalContacts: number;
  processed: number;
  pending: number;
  queued: number;
  dialing: number;
  answered: number;
  busy: number;
  noAnswer: number;
  failed: number;
  completed: number;
  completedContacts: number;
  initialCalls: number;
  retryCalls: number;
  pendingRetries: number;
  totalRetries: number;
  retrySuccessRate: number;
  averageRetryCount: number;
};

export type CampaignRetryPolicyInput = {
  retryEnabled?: boolean;
  maxRetries?: number;
  retryDelaySeconds?: number;
  retryOnBusy?: boolean;
  retryOnNoAnswer?: boolean;
  retryOnFailed?: boolean;
  retryOnCancelled?: boolean;
  retryOnVoicemail?: boolean;
  retryOnMissed?: boolean;
};

export type CampaignRetryPolicyView = {
  retryEnabled: boolean;
  maxRetries: number;
  retryDelaySeconds: number;
  retryOnBusy: boolean;
  retryOnNoAnswer: boolean;
  retryOnFailed: boolean;
  retryOnCancelled: boolean;
  retryOnVoicemail: boolean;
  retryOnMissed: boolean;
};

export type CampaignExecutionProgress = {
  processedCount: number;
  totalContacts: number;
  percentComplete: number;
  estimatedCompletionAt: string | null;
};

export type CampaignExecutionView = {
  id: string;
  campaignId: string;
  status: CampaignExecutionStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
  processedCount: number;
  totalContacts: number;
  correlationId: string | null;
  failureReason: string | null;
  estimatedCompletionAt: string | null;
  createdAt: string;
  updatedAt: string;
};
