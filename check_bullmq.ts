
import { campaignExecutionQueue } from './src/server/queues/campaign-execution.queue';
async function run() {
    if (!campaignExecutionQueue) {
        console.log('Queue not found');
        process.exit(1);
    }
    const delayed = await campaignExecutionQueue.getDelayed();
    const waiting = await campaignExecutionQueue.getWaiting();
    const active = await campaignExecutionQueue.getActive();
    
    console.log('Delayed jobs:', delayed.length);
    for (const job of delayed) {
        if (job.data.isReactivation) {
           console.log('Reactivation Job ID:', job.id, 'Stage:', job.data.qStage, 'Scheduled at:', job.data.scheduledAt);
        }
    }
    console.log('Waiting jobs:', waiting.length);
    console.log('Active jobs:', active.length);
    process.exit(0);
}
run().catch(console.error);

