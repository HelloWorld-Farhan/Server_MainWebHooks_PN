import { Worker, Job } from "bullmq";
import { redisConnection } from "./redis.client";
import { CAMPAIGN_EXECUTION_QUEUE_NAME, CampaignExecutionJobData, campaignExecutionQueue } from "./campaign-execution.queue";
import prisma from "@/server/lib/prisma";
import { CampaignGateway } from "@/modules/websockets/campaign.gateway";

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

        // Safety check for queued schedules: if another campaign is currently running, wait 5 mins
        try {
          const currentStateStr = await redisConnection!.get(`campaign-state:${companyId}`);
          if (currentStateStr) {
            const state = JSON.parse(currentStateStr);
            // Check if there's a running campaign that is NOT this current job
            if (state.status === "running" && state.activeJobId && state.activeJobId !== job.id) {
              console.log(`[Queueing] Company ${companyId} is already running a campaign. Re-queueing job ${job.name} for 5 minutes later.`);
              // Re-add the job to the queue with a 5 minute delay
              await campaignExecutionQueue?.add(job.name, job.data, {
                jobId: job.id, // Keep the same unique ID
                delay: 5 * 60 * 1000, 
                removeOnComplete: true,
                removeOnFail: true
              });
              return; // Exit cleanly, the new delayed job will wake up later
            }
          }
        } catch (e) {
          console.error("Error checking campaign state during worker startup:", e);
        }

        // When we start running, make sure to claim this job ID so others know WE are the ones running
        try {
          const currentStateStr = await redisConnection!.get(`campaign-state:${companyId}`);
          if (currentStateStr) {
            const state = JSON.parse(currentStateStr);
            await redisConnection!.set(`campaign-state:${companyId}`, JSON.stringify({ ...state, activeJobId: job.id }));
          }
        } catch (e) {
          console.error("Failed to set activeJobId:", e);
        }

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
                // Broadcast WebSocket event
                const gateway = CampaignGateway.getInstance();
                if (gateway) {
                  gateway.broadcastCampaignUpdate(companyId, newState);
                }
             }
          };

          // Update status to running immediately when the job starts (useful for scheduled jobs)
          await updateRedisState(prev => ({ ...prev, status: "running" }));

          let shouldAbort = false;
          let isPaused = false;
          while (currentIndex < leads.length || activeCallCount > 0) {
            // Check if the user force-stopped (cleared or stopped) the campaign
            const currentStateStr = await redisConnection!.get(`campaign-state:${companyId}`);
            if (!currentStateStr) {
              shouldAbort = true;
            } else {
              const state = JSON.parse(currentStateStr);
              if (state.status === "force_stopped") {
                shouldAbort = true;
              }
              isPaused = state.status === "paused";
            }

            if (shouldAbort) {
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
            
            if (isPaused) {
              await new Promise(res => setTimeout(res, 2000));
              continue;
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
                        providerCallId: `pending-${publicId}`, // Prevent unique constraint violation on null
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
                          custom_parameters: JSON.stringify({ name: lead.name, companyId, pendingCallId: publicId }),
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
                 const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(campaignId);
                 const dbCalls = await prisma.callLog.findMany({
                   where: { companyId, campaignId: isValidObjectId ? campaignId : null, direction: "OUTBOUND" },
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

          if (!shouldAbort) {
            let finalState: any = null;
            await updateRedisState(prev => {
              if (prev.status === "force_stopped" || prev.status === "idle") return prev;
              finalState = {
                ...prev,
                status: "completed",
                completedCalls: prev.leads?.length || 0,
              };
              return finalState;
            });
            console.log(`Campaign completed for company: ${companyId}`);

            // -------------------------------------------------------------
            // PHASE 2: AUTO-REACTIVATION ENGINE
            // -------------------------------------------------------------
            if (finalState && finalState.leads) {
              const failedLeads = finalState.leads.filter((l: any) => l.isFailed);
              if (failedLeads.length > 0) {
                const dbCampaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
                if (dbCampaign) {
                  let nextStage: any = null;
                  let nextHour = 0;

                  // Stage progression logic
                  if (dbCampaign.stage === "MAIN") { nextStage = "Q1"; nextHour = 11; }
                  else if (dbCampaign.stage === "Q1") { nextStage = "Q2"; nextHour = 14; }
                  else if (dbCampaign.stage === "Q2") { nextStage = "Q3"; nextHour = 17; }

                  if (nextStage) {
                    try {
                      // 1. Create the new Campaign record in the database
                      const nextResourceKey = `${dbCampaign.resourceKey}-${nextStage}-${Date.now().toString().slice(-4)}`;
                      
                      const nextCampaign = await prisma.campaign.create({
                        data: {
                          companyId,
                          resourceKey: nextResourceKey,
                          name: `${dbCampaign.name} - Reactivation ${nextStage}`,
                          stage: nextStage,
                          parentCampaignId: dbCampaign.parentCampaignId || dbCampaign.id,
                          direction: dbCampaign.direction,
                          aiEnabled: dbCampaign.aiEnabled,
                          systemPrompt: dbCampaign.systemPrompt,
                          aiConfig: dbCampaign.aiConfig || {},
                          status: "ACTIVE" // Scheduled campaigns are active until completed
                        }
                      });

                      // 2. Calculate delay until tomorrow at the specified hour
                      const now = new Date();
                      const nextDay = new Date(now);
                      nextDay.setDate(nextDay.getDate() + 1);
                      nextDay.setHours(nextHour, 0, 0, 0);
                      
                      // If somehow the calculated time is in the past (e.g. timezone edge cases), add a day
                      if (nextDay.getTime() <= now.getTime()) {
                        nextDay.setDate(nextDay.getDate() + 1);
                      }
                      
                      const delayMs = nextDay.getTime() - now.getTime();

                      // 3. Import and submit to the queue
                      const { startCampaignJob } = await import('./campaign-execution.queue');
                      await startCampaignJob({
                        companyId,
                        campaignId: nextCampaign.id,
                        didNumber,
                        leads: failedLeads.map((l: any) => ({ phone: l.phone, name: l.name })),
                        channels,
                        isReactivation: true,
                        scheduledAt: nextDay.toISOString(),
                        uploadedFileName: job.data.uploadedFileName
                      }, delayMs);

                      console.log(`[Reactivation Engine] Scheduled ${nextStage} for Campaign ${campaignId} at ${nextDay.toISOString()} with ${failedLeads.length} leads.`);
                    } catch (reactivationError) {
                      console.error(`[Reactivation Engine] Failed to schedule ${nextStage} for Campaign ${campaignId}:`, reactivationError);
                    }
                  } else {
                     console.log(`[Reactivation Engine] Campaign ${campaignId} reached final stage (Q3). No further reactivations.`);
                  }
                }
              } else {
                console.log(`[Reactivation Engine] Campaign ${campaignId} had 100% success! No reactivation needed.`);
              }
            }
            // -------------------------------------------------------------

          } else {
            console.log(`Campaign loop aborted for company: ${companyId}, skipping completion state.`);
          }

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
