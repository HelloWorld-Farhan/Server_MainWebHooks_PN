
import { campaignExecutionQueue } from './src/server/queues/campaign-execution.queue';
async function run() {
    if (!campaignExecutionQueue) {
        console.log('Queue not found');
        process.exit(1);
    }
    const waiting = await campaignExecutionQueue.getWaiting();
    const active = await campaignExecutionQueue.getActive();
    const failed = await campaignExecutionQueue.getFailed();
    
    console.log('Waiting jobs:', waiting.length);
    console.log('Active jobs:', active.length);
    if (active.length > 0) {
        console.log('Active job data:', active[0].id, active[0].data.qStage);
    }
    console.log('Failed jobs:', failed.length);
    if (failed.length > 0) {
        console.log('Last failed job reason:', failed[0].failedReason);
    }
    process.exit(0);
}
run().catch(console.error);

