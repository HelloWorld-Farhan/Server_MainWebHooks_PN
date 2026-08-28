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
            // Check if the user force-stopped (cleared) the campaign
            const currentStateStr = await redisConnection!.get(`campaign-state:${companyId}`);
            if (!currentStateStr) {
              console.log(`Campaign force stopped for company: ${companyId}. Aborting worker.`);
              
              // Clean up any remaining PENDING calls in DB to FAILED so they aren't stuck
              try {
                 await prisma.callLog.updateMany({
                   where: {
                     companyId,
                     direction: "OUTBOUND",
                     status: "PENDING"
                   },
                   data: { status: "FAILED", durationSeconds: 0 }
                 });
              } catch (e) {
                 console.error("Cleanup error on force stop", e);
              }
              break;
            }
            
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
                    // Create or find a lead to attach to the CallLog, essential for webhook matching
                    let leadRecordId = lead.id;
                    if (!leadRecordId) {
                      const corePhone = lead.phone.replace(/\D/g, "").slice(-10);
                      const foundLead = await prisma.lead.findFirst({
                        where: { companyId, phone: { contains: corePhone } }
                      });
                      if (foundLead) {
                        leadRecordId = foundLead.id;
                      } else {
                        let stage = await prisma.leadPipelineStage.findFirst({ where: { companyId, slug: "new" } });
                        if (!stage) {
                          stage = await prisma.leadPipelineStage.create({ data: { companyId, name: "New", slug: "new", order: 1 } });
                        }
                        const newLead = await prisma.lead.create({
                          data: { companyId, phone: lead.phone, firstName: lead.name || "Outbound", lastName: "Contact", stageId: stage.id }
                        });
                        leadRecordId = newLead.id;
                      }
                    }

                    // Create the PENDING CallLog so the webhook can find it regardless of DID ownership
                    const publicId = `OUT-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
                    
                    // Validate campaignId as a 24-character hex string for MongoDB ObjectId
                    const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(campaignId);
                    
                    await prisma.callLog.create({
                      data: {
                        publicId,
                        callLogId: publicId, // Webhook logic preserves this if it finds the pending call
                        direction: "OUTBOUND",
                        status: "PENDING",
                        startedAt: new Date(),
                        companyId,
                        campaignId: isValidObjectId ? campaignId : null,
                        durationSeconds: 0,
                        provider: "voicelink",
                        leadId: leadRecordId
                      }
                    });

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
                         
                         // Clean up stuck calls in the database
                         if (hasTimedOut) {
                           try {
                             await prisma.callLog.updateMany({
                               where: {
                                 companyId,
                                 lead: { phone: { contains: corePhone } },
                                 status: { in: ["PENDING", "RINGING"] }
                               },
                               data: { status: "FAILED", durationSeconds: 0 }
                             });
                           } catch (err) {
                             console.error("Failed to clean up timed out calls in db", err);
                           }
                         }
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
