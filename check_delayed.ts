
import Redis from 'ioredis';
const redis = new Redis('redis://:Propnexai@123@200.234.34.240:6379');
async function run() {
    try {
        const delayed = await redis.zrange('bull:campaign-execution-queue:delayed', 0, -1);
        console.log('Delayed jobs:', delayed);
        for (const id of delayed) {
            const job = await redis.hgetall('bull:campaign-execution-queue:' + id);
            if (job.data) {
                const data = JSON.parse(job.data);
                console.log('Delayed Job ID:', id);
                console.log('Campaign:', data.campaignId);
                console.log('Leads length:', data.leads?.length);
            }
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
run();

