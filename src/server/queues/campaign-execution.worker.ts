import { Worker, Job } from "bullmq";
import { redisConnection } from "./redis.client";
import { CAMPAIGN_EXECUTION_QUEUE_NAME, CampaignExecutionJobData, campaignExecutionQueue } from "./campaign-execution.queue";
import prisma from "@/server/lib/prisma";
import { CampaignGateway } from "@/modules/websockets/campaign.gateway";

const BONVOICE_API_URL = process.env.BONVOICE_BASE_URL || "https://backend.pbx.bonvoice.com";

async function loginToBonvoice() {
  // Use the static token provided by the user, or fallback to env var
  const token = process.env.BONVOICE_TOKEN || "27d4d72e911173a1e171007d98d8d2d1fd4bfa85";
  return token;
}

export const campaignExecutionWorker = redisConnection
  ? new Worker<CampaignExecutionJobData>(
      CAMPAIGN_EXECUTION_QUEUE_NAME,
      async (job: Job<CampaignExecutionJobData>) => {
        let { companyId, campaignId, didNumber: rawDidNumber, leads, channels: rawChannels, isReactivation, qStage, reactivationDateKey, allOriginalLeads } = job.data;
        const channels = Number(rawChannels) || 1;
        let didNumber = rawDidNumber ? rawDidNumber.trim() : "";
        if (didNumber && !didNumber.startsWith("+")) {
           if (didNumber.length === 10) didNumber = "+91" + didNumber;
           else if (didNumber.length === 12 && didNumber.startsWith("91")) didNumber = "+" + didNumber;
           else if (didNumber.length === 11 && didNumber.startsWith("0")) didNumber = "+91" + didNumber.substring(1);
           else didNumber = "+" + didNumber;
        }
        
        // REAL-TIME AUTO-FILTERING FOR REACTIVATION
        if (isReactivation && reactivationDateKey && (qStage === "Q2" || qStage === "Q3")) {
          console.log(`[Reactivation Pre-Execution] Filtering ${qStage} leads for ${companyId} against previous waves...`);
          const baseLeads = allOriginalLeads || leads;
          if (baseLeads && baseLeads.length > 0) {
            const compShort = companyId.replace(/-/g, "").slice(0, 8);
            const didDigits = didNumber.replace(/\D/g, "").slice(-6);
            
            const priorCorrelationIds = qStage === "Q2" 
               ? [`reactivation-${reactivationDateKey}-${compShort}-${didDigits}-q1`]
               : [`reactivation-${reactivationDateKey}-${compShort}-${didDigits}-q1`,
                  `reactivation-${reactivationDateKey}-${compShort}-${didDigits}-q2`];
            
            const priorLogs = await prisma.callLog.findMany({
              where: {
                companyId,
                correlationId: { in: priorCorrelationIds },
              },
              select: { leadId: true, status: true, durationSeconds: true }
            });
            
            const succeededLeadIds = new Set(
              priorLogs
                .filter((l) => l.status === "COMPLETED" && (l.durationSeconds || 0) > 0)
                .map((l) => l.leadId)
                .filter(Boolean)
            );
            
            leads = baseLeads.filter((lead) => {
              const id = lead.id || lead.leadId;
              return !succeededLeadIds.has(id);
            });
            
            if (leads.length === 0) {
               console.log(`[Reactivation] All leads successfully contacted in previous waves. Skipping ${qStage}.`);
               return; // Exit cleanly, no calls to make
            } else {
               console.log(`[Reactivation] Filtered down to ${leads.length} failed leads for ${qStage}.`);
            }
          }
        }
        
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
          const token = await loginToBonvoice();
          
          let dbAgentUrl = "";
          let dbPhoneNumberId: string | null = null;
          try {
            // The DID in DB may be stored in a different format AND/OR under a different companyId
            // Try multiple number formats, first scoped to companyId, then globally
            const rawDid = rawDidNumber ? rawDidNumber.trim() : "";
            const digitsOnly = rawDid.replace(/\D/g, "");
            const last10 = digitsOnly.slice(-10);
            
            const numberFormats = [
              { number: rawDid },
              { number: digitsOnly },
              { number: didNumber },
              { number: { endsWith: last10 } }
            ];

            // First try: scoped to company
            let phoneNumber = await prisma.phoneNumber.findFirst({
              where: { companyId, direction: "OUTBOUND", OR: numberFormats }
            });
            
            // Second try: global search (DID may be registered under a different/parent company)
            if (!phoneNumber || !phoneNumber.agentUrl) {
              const globalPhone = await prisma.phoneNumber.findFirst({
                where: { direction: "OUTBOUND", OR: numberFormats }
              });
              if (globalPhone && globalPhone.agentUrl) {
                phoneNumber = globalPhone;
                console.log(`⚠️ agentUrl found under companyId ${globalPhone.companyId} (campaign companyId: ${companyId})`);
              }
            }

            if (phoneNumber) {
              dbPhoneNumberId = phoneNumber.id;
              if (phoneNumber.agentUrl) {
                dbAgentUrl = phoneNumber.agentUrl;
                console.log(`✅ Found agentUrl for DID ${rawDid}: ${dbAgentUrl}`);
              }
            } else {
              console.warn(`⚠️ No agentUrl found in DB for DID ${rawDid}. Calls will fail if BONVOICE_VOICEBOT_URL env is also not set.`);
            }
          } catch (e) {
            console.error("Failed to lookup agentUrl from DB:", e);
          }

          let activeCallIds = new Set<string>();
          let activeCallTimeouts = new Map<string, number>();
          let activeCallCount = 0;
          let completedCount = 0;
          let currentIndex = 0;
          let leadPhoneMap = new Map<string, string>(); // Maps callLogId to lead phone
          
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
            let isPreempted = false;
            // Check if the user force-stopped (cleared or stopped) the campaign
            const currentStateStr = await redisConnection!.get(`campaign-state:${companyId}`);
            if (!currentStateStr) {
              shouldAbort = true;
            } else {
              const state = JSON.parse(currentStateStr);
              if (state.status === "force_stopped" && state.activeJobId === job.id) {
                shouldAbort = true;
              } else if (state.activeJobId !== job.id) {
                // My job got preempted! Check if I was moved to the paused holding key
                const pausedStateStr = await redisConnection!.get(`campaign-state:paused:${companyId}`);
                if (pausedStateStr) {
                  const pausedState = JSON.parse(pausedStateStr);
                  if (pausedState.activeJobId === job.id) {
                    isPaused = true;
                    isPreempted = true;
                  } else {
                    shouldAbort = true; // Something else took over
                  }
                } else {
                  shouldAbort = true;
                }
              } else {
                isPaused = state.status === "paused";
              }
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

              if (job.data.isReactivation && (job.data.qStage === "Q2" || job.data.qStage === "Q3") && lead.id) {
                 const startOfToday = new Date();
                 startOfToday.setHours(0,0,0,0);
                 const successfulCallsToday = await prisma.callLog.count({
                    where: {
                       leadId: lead.id,
                       status: "COMPLETED",
                       durationSeconds: { gt: 0 },
                       startedAt: { gte: startOfToday }
                    }
                 });
                 if (successfulCallsToday > 0) {
                     console.log(`[Reactivation Engine] Skipping lead ${lead.phone} in ${job.data.qStage} because they successfully answered earlier today.`);
                     // Still increment completed calls for UI progress
                     await updateRedisState(prev => ({ 
                        ...prev, 
                        completedCalls: prev.completedCalls + 1,
                        successfulCalls: prev.successfulCalls + 1
                     }));
                     continue;
                 }
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
                    
                    const callLog = await prisma.callLog.create({
                      data: {
                        publicId,
                        callLogId: publicId, // Webhook logic preserves this if it finds the pending call
                        direction: "OUTBOUND",
                        status: "PENDING",
                        startedAt: new Date(),
                        companyId,
                        campaignId: isValidObjectId ? campaignId : null,
                        correlationId: campaignId, // Save the original campaignId here for Reactivation tracking (q1/q2/q3)
                        durationSeconds: 0,
                        provider: "BONVOICE",
                        providerCallId: `pending-${publicId}`, // Prevent unique constraint violation on null
                        leadId: leadRecordId,
                        phoneNumberId: dbPhoneNumberId,
                        historicalDidString: didNumber || "Unknown",
                        historicalChannels: channels
                      }
                    });

                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 15000);
                    
                    // Strip leading zeros from DID — Bonvoice requires 10-digit format (e.g. 7946350797 not 07946350797)
                    const cleanDid = didNumber.replace(/\D/g, "").slice(-10);
                    const cleanDestination = lead.phone.replace(/\D/g, "").slice(-10);
                    // Use publicId as eventId so the webhook can correctly match the CallLog
                    const eventId = publicId;
                    // Construct the dynamic payload from the lead's customFields
                    const customFields = lead.customFields && typeof lead.customFields === 'object'
                      ? lead.customFields 
                      : (typeof lead.customFields === 'string' ? JSON.parse(lead.customFields || "{}") : {});

                    const voicebotProvider = process.env.BONVOICE_VOICEBOT_PROVIDER || "BONVOICE";
                    const voicebotUrlToUse = dbAgentUrl || process.env.BONVOICE_VOICEBOT_URL;
                    
                    // Native Bonvoice payload with custom CSV fields injected dynamically
                    const callPayload = {
                      autocallType: "5",
                      destination: cleanDestination,     
                      legACallerID: cleanDid,            
                      eventID: eventId,
                      voicebotProvider: voicebotProvider,
                      callBackUrl: "https://voice.propnexai.com/api/webhooks/bonvoice/notification",
                      callbackUrl: "https://voice.propnexai.com/api/webhooks/bonvoice/notification",
                      webhookURL: "https://voice.propnexai.com/api/webhooks/bonvoice/notification",
                      eventUrl: "https://voice.propnexai.com/api/webhooks/bonvoice/notification",
                      statusCallback: "https://voice.propnexai.com/api/webhooks/bonvoice/notification",
                      ...(voicebotUrlToUse ? { voicebotURL: voicebotUrlToUse } : {}),
                      ...customFields
                    };
                    
                    console.log(`📞 Calling ${cleanDestination} from ${cleanDid} natively via Bonvoice`);
                    const res = await fetch(`${BONVOICE_API_URL}/autoDialManagement/autoCallBridging/`, {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                        Authorization: `Token ${token}`,
                      },
                      body: JSON.stringify(callPayload),
                      signal: controller.signal as any,
                    });
                    clearTimeout(timeoutId);
                    
                    const responseText = await res.text();
                    let responseJson: any = null;
                    try { responseJson = JSON.parse(responseText); } catch (e) {}
                  
                  if (!res.ok || (responseJson && responseJson.status === "error")) {
                    console.error(`Failed to push lead ${lead.phone} to Bonvoice:`, responseText);
                    
                    // Mark CallLog as FAILED so it doesn't get stuck in PENDING
                    await prisma.callLog.update({
                      where: { id: callLog.id },
                      data: { 
                        status: "FAILED"
                      }
                    }).catch(console.error);

                    await markAsFailed(lead.phone, didNumber);
                    
                    await updateRedisState((prev) => {
                       const updatedLeads = (prev.leads || []).map((l: any) => l.phone === lead.phone ? { ...l, called: true, isFailed: true } : l);
                       return { ...prev, leads: updatedLeads, failedCalls: updatedLeads.filter((l: any) => l.isFailed).length, completedCalls: prev.completedCalls + 1 };
                    });
                    
                    activeCallCount--;
                    completedCount++;
                  } else {
                    // responseJson was already parsed from responseText above — do NOT call res.json() again
                    // Bonvoice autoCallBridging returns { responseCode: 200, responseDescription: "Success" }
                    // There is no UUID returned; tracking is done via eventID (callLog.id)
                    const isSuccess = responseJson?.responseCode === 200 || responseJson?.responseType === "Success" || res.ok;
                    if (!isSuccess) {
                      console.warn(`Bonvoice returned non-success for ${lead.phone}:`, responseText);
                    } else {
                      console.log(`✅ Call initiated for ${lead.phone} via Bonvoice (eventID: ${callLog.id})`);
                      
                      // We set the initial status to RINGING.
                      // The Bonvoice notification webhook will later update it to ANSWERED.
                      await prisma.callLog.update({
                        where: { id: callLog.id },
                        data: { status: "RINGING" }
                      }).catch(console.error);
                    }
                    
                    activeCallIds.add(callLog.id);
                    leadPhoneMap.set(callLog.id, lead.phone);
                    activeCallTimeouts.set(callLog.id, Date.now());
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
            
            // If activeCallCount drops to 0 immediately (e.g. all API calls failed),
            // prevent an infinite tight loop that crashes the server by sleeping briefly.
            if (activeCallCount === 0 && currentIndex < leads.length) {
               await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            if (activeCallCount > 0) {
               await new Promise(resolve => setTimeout(resolve, 3000));
               
                try {
                 if (activeCallIds.size > 0) {
                     const dbCalls = await prisma.callLog.findMany({
                       where: { id: { in: Array.from(activeCallIds) } }
                     });
                     
                     let newlyFinishedCount = 0;
                     const finishedPhones: {phone: string, isFailed: boolean}[] = [];
                     
                     for (const callLogId of Array.from(activeCallIds)) {
                         const c = dbCalls.find(dbC => dbC.id === callLogId);
                         const phone = leadPhoneMap.get(callLogId) || "";
                         
                         const timeElapsed = Date.now() - (activeCallTimeouts.get(callLogId) || 0);
                         const status = c ? (c.status?.toLowerCase() || "") : "";
                         const isAnswered = status === "answered" || status === "in-progress";
                         // 30 minutes max if answered, 3 minutes max if stuck ringing
                         const dynamicTimeout = isAnswered ? 30 * 60 * 1000 : 3 * 60 * 1000;
                         const hasTimedOut = timeElapsed > dynamicTimeout;
                         
                         let isFinished = false;
                         let isFailed = false;
                         
                         if (!c || hasTimedOut) {
                             isFinished = true;
                             isFailed = true; // timeout or disappeared
                             if (hasTimedOut && c) {
                                 await prisma.callLog.update({ where: { id: callLogId }, data: { status: "FAILED" } }).catch(()=>{});
                             }
                         } else {
                             if (!["pending", "ringing", "queued", "dispatching", "queued_at_provider", "answered", "in-progress"].includes(status)) {
                                 isFinished = true;
                                 if (["failed", "missed", "busy", "no-answer", "cancelled"].includes(status)) {
                                     isFailed = true;
                                 }
                             }
                         }
                         
                         if (isFinished) {
                             activeCallIds.delete(callLogId);
                             activeCallTimeouts.delete(callLogId);
                             leadPhoneMap.delete(callLogId);
                             activeCallCount--;
                             completedCount++;
                             
                             newlyFinishedCount++;
                             finishedPhones.push({ phone, isFailed });
                         }
                     }
                     
                     if (newlyFinishedCount > 0) {
                         await updateRedisState(prev => {
                           const updatedLeads = (prev.leads || []).map((l: any) => {
                             const finishedEntry = finishedPhones.find(fp => fp.phone === l.phone);
                             if (finishedEntry) {
                               return { ...l, called: true, isFailed: finishedEntry.isFailed };
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
                // NEW Reactivation Logic (cron-based waves) is now handled entirely by BullMQ pre-scheduled delays.
                // Q2 and Q3 are auto-scheduled by the cron at 11:59 PM and self-filter at execution time.
                if (finalState.isReactivation && campaignId.startsWith("reactivation-")) {
                  // No action needed here anymore, filtering happens at execution time.
                }
                // Handle OLD Auto-Reactivation Logic
                else {
                  const isValidObjectIdForReactivation = /^[0-9a-fA-F]{24}$/.test(campaignId);
                  let dbCampaign: any = null;
                  if (isValidObjectIdForReactivation) {
                    dbCampaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
                  }
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
                      const { startCampaignJob } = require('./campaign-execution.queue');
                      await startCampaignJob({
                        companyId,
                        campaignId: nextCampaign.id,
                        didNumber,
                        leads: failedLeads.map((l: any) => ({ phone: l.phone, name: l.name })),
                        channels,
                        isReactivation: true,
                        qStage: nextStage,
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
                }
              } else {
                console.log(`[Reactivation Engine] Campaign ${campaignId} had 100% success! No reactivation needed.`);
              }
            }
            // -------------------------------------------------------------

          } else {
            console.log(`Campaign loop aborted for company: ${companyId}, skipping completion state.`);
          }

          // -------------------------------------------------------------
          // PHASE 3: PRIORITY ENGINE AUTO-RESUME
          // -------------------------------------------------------------
          try {
            const pausedStateStr = await redisConnection!.get(`campaign-state:paused:${companyId}`);
            if (pausedStateStr) {
              const pausedState = JSON.parse(pausedStateStr);
              if (!job.data.isReactivation) {
                 console.log(`[Traffic Cop] Live Campaign finished. Auto-resuming Reactivation for company ${companyId}`);
                 const resumedState = { ...pausedState, status: "running" };
                 await redisConnection!.set(`campaign-state:${companyId}`, JSON.stringify(resumedState));
                 await redisConnection!.del(`campaign-state:paused:${companyId}`);
                 const gateway = CampaignGateway.getInstance();
                 if (gateway) gateway.broadcastCampaignUpdate(companyId, resumedState);
              }
            } else {
              // If we reached the end of the last campaign, clear the state so UI returns to idle
              const currentStateStr = await redisConnection!.get(`campaign-state:${companyId}`);
              if (currentStateStr) {
                 const currentState = JSON.parse(currentStateStr);
                 if (currentState.status === "completed" || currentState.status === "force_stopped" || shouldAbort) {
                    // Do nothing, let clearCampaignState handle it, or just leave it for UI to show "completed"
                 }
              }
            }
          } catch (resumeErr) {
            console.error("Failed to auto-resume paused reactivation:", resumeErr);
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
