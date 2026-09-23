
import { campaignExecutionQueue } from './src/server/queues/campaign-execution.queue';
async function run() {
   const active = await campaignExecutionQueue.getActive();
   const waiting = await campaignExecutionQueue.getWaiting();
   const delayed = await campaignExecutionQueue.getDelayed();
   const failed = await campaignExecutionQueue.getFailed();
   const completed = await campaignExecutionQueue.getCompleted();
   console.log('Active:', active.map(j => ({id: j.id, stage: j.data.qStage})));
   console.log('Waiting:', waiting.map(j => ({id: j.id, stage: j.data.qStage})));
   console.log('Delayed:', delayed.map(j => ({id: j.id, stage: j.data.qStage, delay: j.delay, name: j.name})));
   process.exit(0);
}
run();

