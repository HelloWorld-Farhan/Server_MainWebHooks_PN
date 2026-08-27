import { Worker, Job } from "bullmq";
import { redisConnection } from "./redis.client";
import { CAMPAIGN_EXECUTION_QUEUE_NAME, CampaignExecutionJobData } from "./campaign-execution.queue";
import prisma from "@/server/lib/prisma";

const VOICELINK_API_URL = "https://app.voicelink.co.in/api";

async function loginToVoicelink() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const loginRes = await fetch(`${VOICELINK_API_URL}/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        username: "propnex",
        password: "PropnexAi2025@#",
      }),
      signal: controller.signal as any,
    });
    clearTimeout(timeoutId);

    if (!loginRes.ok) {
      throw new Error("Failed to authenticate with Voicelink");
    }

    const loginData = await loginRes.json();
    const token = loginData.data?.access_token || loginData.access_token;

    if (!token) {
      throw new Error("Invalid authentication response from Voicelink");
    }

    return token;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export const campaignExecutionWorker = redisConnection
  ? new Worker<CampaignExecutionJobData>(
      CAMPAIGN_EXECUTION_QUEUE_NAME,
      async (job: Job<CampaignExecutionJobData>) => {
        const { companyId, campaignId, didNumber, leads, channels } = job.data;
        console.log(`Starting Campaign Execution for company: ${companyId}`);

        try {
          const token = await loginToVoicelink();

          let activeCalls = new Map<string, number>();
          let activeCallTimeouts = new Map<string, number>();
          let activeCallCount = 0;
          let completedCount = 0;
          let currentIndex = 0;
          
          const CALL_TIMEOUT_MS = 120000;

          const markAsFailed = async (phone: string, assignedNumber: string) => {
            try {
              console.error(`Marked ${phone} as failed immediately`);
            } catch (e) {
              console.error("Failed to mark call as failed in DB", e);
            }
          };

          const updateRedisState = async (updateFn: (prevState: any) => any) => {
             const stateStr = await redisConnection!.get(`campaign-state:${companyId}`);
             if (stateStr) {
                const state = JSON.parse(stateStr);
                const newState = updateFn(state);
                await redisConnection!.set(`campaign-state:${companyId}`, JSON.stringify(newState));
             }
          };

          while (currentIndex < leads.length || activeCallCount > 0) {
            
            const batchPromises: Promise<void>[] = [];
            
            while (activeCallCount < channels && currentIndex < leads.length) {
              const lead = leads[currentIndex];
              currentIndex++;
              
              if (lead.isInvalid) {
                continue;
              }

              activeCallCount++;
              
              batchPromises.push((async () => {
                try {
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 15000);
                  const res = await fetch(`${VOICELINK_API_URL}/v1/add_lead`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "Accept": "application/json",
                      Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                      did_number: didNumber,
                      customer_number: lead.phone.replace(/\D/g, "").slice(-10),
                      country_code: "91",
                      custom_parameters: JSON.stringify({ name: lead.name, companyId }),
                    }),
                    signal: controller.signal as any,
                  });
                  clearTimeout(timeoutId);
                  
                  if (!res.ok) {
                    const errText = await res.text();
                    console.error(`Failed to push lead ${lead.phone} to Voicelink:`, errText);
                    await markAsFailed(lead.phone, didNumber);
                    
                    await updateRedisState((prev) => {
                       const updatedLeads = (prev.leads || []).map((l: any) => l.phone === lead.phone ? { ...l, called: true, isFailed: true } : l);
                       return { ...prev, leads: updatedLeads, failedCalls: updatedLeads.filter((l: any) => l.isFailed).length, completedCalls: prev.completedCalls + 1 };
                    });
                    
                    activeCallCount--;
                    completedCount++;
                  } else {
                    activeCalls.set(lead.phone, (activeCalls.get(lead.phone) || 0) + 1);
                    activeCallTimeouts.set(lead.phone, Date.now());
                  }
                } catch (err: any) {
                  console.error(`Failed to push lead ${lead.phone}:`, err.message);
                  await markAsFailed(lead.phone, didNumber);
                  await updateRedisState((prev) => {
                       const updatedLeads = (prev.leads || []).map((l: any) => l.phone === lead.phone ? { ...l, called: true, isFailed: true } : l);
                       return { ...prev, leads: updatedLeads, failedCalls: updatedLeads.filter((l: any) => l.isFailed).length, completedCalls: prev.completedCalls + 1 };
                    });
                  
                  activeCallCount--;
                  completedCount++;
                }
              })());
            }
            
            if (batchPromises.length > 0) {
              await Promise.all(batchPromises);
            }
            
            if (activeCallCount > 0) {
               await new Promise(resolve => setTimeout(resolve, 3000));
               
               try {
                 const dbCalls = await prisma.callLog.findMany({
                   where: { companyId, direction: "OUTBOUND" },
                   orderBy: { createdAt: 'desc' },
                   take: 50,
                   include: { lead: true }
                 });
                 
                 for (const [phone, count] of Array.from(activeCalls.entries())) {
                   const corePhone = phone.replace(/\D/g, "").slice(-10);
                   
                   const matchingCalls = dbCalls.filter(c => c.lead?.phone?.includes(corePhone) && c.createdAt.getTime() > (activeCallTimeouts.get(phone) || 0) - 10000);
                   
                   const activeMatching = matchingCalls.filter(c => ["pending", "ringing", "answered", "in-progress"].includes(c.status?.toLowerCase() || ""));
                   
                   const timeElapsed = Date.now() - (activeCallTimeouts.get(phone) || 0);
                   const hasTimedOut = timeElapsed > CALL_TIMEOUT_MS;
                   
                   if (activeMatching.length < count || hasTimedOut) {
                     const finishedCount = hasTimedOut ? count : (count - activeMatching.length);
                     
                     const newlyFinished = matchingCalls.filter(c => !["pending", "ringing", "answered", "in-progress"].includes(c.status?.toLowerCase() || ""));
                     const newlyFailedCount = newlyFinished.filter(c => ["failed", "missed", "busy", "no-answer"].includes(c.status?.toLowerCase() || "")).length;
                     
                     if (hasTimedOut || activeMatching.length === 0) {
                       activeCalls.delete(phone);
                       activeCallTimeouts.delete(phone);
                     } else {
                       activeCalls.set(phone, activeMatching.length);
                     }
                     activeCallCount -= finishedCount;
                     completedCount += finishedCount;
                     
                     await updateRedisState(prev => {
                       const updatedLeads = (prev.leads || []).map((l: any) => {
                         if (l.phone === phone) {
                           const isFailed = (newlyFailedCount > 0) || (hasTimedOut && newlyFinished.length === 0);
                           return { ...l, called: true, isFailed };
                         }
                         return l;
                       });
                       
                       const totalFailed = updatedLeads.filter((l: any) => l.isFailed).length;
                       const totalSuccessful = updatedLeads.filter((l: any) => l.called && !l.isFailed).length;
                       
                       return { 
                         ...prev, 
                         completedCalls: completedCount,
                         leads: updatedLeads,
                         failedCalls: totalFailed,
                         successfulCalls: totalSuccessful
                       };
                     });
                   }
                 }
               } catch (pollErr) {
                 console.error("Failed to poll call status in worker", pollErr);
               }
            }
          }

          await updateRedisState(prev => ({
            ...prev,
            status: "completed",
            completedCalls: prev.leads?.length || 0,
          }));
          
          console.log(`Campaign completed for company: ${companyId}`);

        } catch (error) {
          console.error("Campaign worker error:", error);
          const stateStr = await redisConnection!.get(`campaign-state:${companyId}`);
          if (stateStr) {
             const state = JSON.parse(stateStr);
             state.status = "failed";
             state.error = (error as Error).message;
             await redisConnection!.set(`campaign-state:${companyId}`, JSON.stringify(state));
          }
          throw error;
        }
      },
      {
        connection: redisConnection,
        concurrency: 5,
      }
    )
  : null;
