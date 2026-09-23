
import Redis from 'ioredis';
const redis = new Redis('redis://:Propnexai@123@200.234.34.240:6379');
async function run() {
    try {
        const stateStr = await redis.get('campaign-state:6a8bed4d3f5b7c2eea48418e');
        if (stateStr) {
            const state = JSON.parse(stateStr);
            console.log('Campaign:', state.campaignId);
            console.log('Total:', state.totalCalls, 'Completed:', state.completedCalls, 'Successful:', state.successfulCalls);
            console.log('Status:', state.status);
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
run();

