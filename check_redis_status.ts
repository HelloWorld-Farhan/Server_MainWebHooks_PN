
import Redis from 'ioredis';
const redis = new Redis('redis://:Propnexai@123@200.234.34.240:6379');
async function run() {
    try {
        const stateStr = await redis.get('campaign-state:e84992dc-a764-460d-966a-2d2bc336338e');
        if (stateStr) {
            const state = JSON.parse(stateStr);
            console.log('Campaign State:', state.status, 'Completed:', state.completedCalls, 'Failed:', state.failedCalls);
            console.log('Total Leads in state:', state.leads?.length);
            console.log('Called Leads in state:', state.leads?.filter(l => l.called).length);
        } else {
            console.log('No campaign state found');
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
run();

