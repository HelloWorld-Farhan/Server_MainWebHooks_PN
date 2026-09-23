const fs = require('fs');
let c = fs.readFileSync('src/server/queues/campaign-execution.worker.ts', 'utf8');

const oldPhase3 = \// PHASE 3: PRIORITY ENGINE AUTO-RESUME
          // -------------------------------------------------------------
          try {
            const pausedStateStr = await redisConnection!.get(\\\campaign-state:paused:\\\\);
            if (pausedStateStr) {
              const pausedState = JSON.parse(pausedStateStr);
              if (!job.data.isReactivation) {
                 console.log(\\\[Traffic Cop] Live Campaign finished. Auto-resuming Reactivation for company \\\\);
                 const resumedState = { ...pausedState, status: "running" };
                 await redisConnection!.set(redisKey, JSON.stringify(resumedState));
                 await redisConnection!.del(\\\campaign-state:paused:\\\\);
                 const gateway = CampaignGateway.getInstance();
                 if (gateway) gateway.broadcastCampaignUpdate(companyId, resumedState);
              }
            } else {\;

const newPhase3 = \// PHASE 3: PRIORITY ENGINE AUTO-RESUME
          // -------------------------------------------------------------
          try {
            if (!job.data.isReactivation) {
              const reactStateStr = await redisConnection!.get(\\\campaign-state:reactivation:\\\\);
              if (reactStateStr) {
                const reactState = JSON.parse(reactStateStr);
                if (reactState.status === "paused") {
                   console.log(\\\[Traffic Cop] Live Campaign finished. Auto-resuming Reactivation for company \\\\);
                   const resumedState = { ...reactState, status: "running" };
                   await redisConnection!.set(\\\campaign-state:reactivation:\\\\, JSON.stringify(resumedState));
                   const gateway = CampaignGateway.getInstance();
                   if (gateway) gateway.broadcastCampaignUpdate(companyId, resumedState);
                }
              }
            } else {\;

// Note: I might need to replace just a subset because oldPhase3 exact matching is brittle.
// I'll just use string replacement on a smaller substring

const oldSub = \const pausedStateStr = await redisConnection!.get(\\\campaign-state:paused:\\\\);\;
const newSub = \
            if (!job.data.isReactivation) {
              const reactStateStr = await redisConnection!.get(\\\campaign-state:reactivation:\\\\);
              if (reactStateStr) {
                const reactState = JSON.parse(reactStateStr);
                if (reactState.status === "paused") {
                   console.log(\\\[Traffic Cop] Live Campaign finished. Auto-resuming Reactivation for company \\\\);
                   const resumedState = { ...reactState, status: "running" };
                   await redisConnection!.set(\\\campaign-state:reactivation:\\\\, JSON.stringify(resumedState));
                   const gateway = CampaignGateway.getInstance();
                   if (gateway) gateway.broadcastCampaignUpdate(companyId, resumedState);
                }
              }
            }
\;

// let's do a more robust approach
const lines = c.split('\\n');
let inPhase3 = false;
let newLines = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('PHASE 3: PRIORITY ENGINE AUTO-RESUME')) {
    inPhase3 = true;
    newLines.push(lines[i]);
    newLines.push(lines[i+1]); // ---
    newLines.push(lines[i+2]); // try {
    newLines.push(newSub);
    
    // skip the old block
    let j = i + 3;
    while(j < lines.length && !lines[j].includes('} else {')) {
       j++;
    }
    // lines[j] is '} else {'
    // but wait! If I just skip until } else {, I might skip too much.
    // Let's just find the exact block.
  }
}

// Just use standard RegExp
c = c.replace(/try\s*\{\s*const pausedStateStr = await redisConnection!\.get\(\campaign-state:paused:\$\{companyId\}\\);[\s\S]*?\} else \{/m, \	ry {
            if (!job.data.isReactivation) {
              const reactStateStr = await redisConnection!.get(\\\campaign-state:reactivation:\\\\);
              if (reactStateStr) {
                const reactState = JSON.parse(reactStateStr);
                if (reactState.status === "paused") {
                   console.log(\\\[Traffic Cop] Live Campaign finished. Auto-resuming Reactivation for company \\\\);
                   const resumedState = { ...reactState, status: "running" };
                   await redisConnection!.set(\\\campaign-state:reactivation:\\\\, JSON.stringify(resumedState));
                   const gateway = CampaignGateway.getInstance();
                   if (gateway) gateway.broadcastCampaignUpdate(companyId, resumedState);
                }
              }
            }
            if (false) {\);

// Also fix the line 199 inside the loop where it checks for paused.
c = c.replace(
  /const pausedStateStr = await redisConnection!\.get\(\campaign-state:paused:\$\{companyId\}\\);/,
  \// Legacy paused state string check removed\
);

fs.writeFileSync('src/server/queues/campaign-execution.worker.ts', c);
