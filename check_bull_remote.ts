
import Redis from 'ioredis';
const redis = new Redis('redis://:Propnexai@123@200.234.34.240:6379');
async function run() {
    try {
        const active = await redis.lrange('bull:campaign-execution-queue:active', 0, -1);
        const waiting = await redis.lrange('bull:campaign-execution-queue:wait', 0, -1);
        const delayed = await redis.zrange('bull:campaign-execution-queue:delayed', 0, -1);
        
        console.log('Active jobs:', active);
        console.log('Waiting jobs:', waiting);
        console.log('Delayed jobs:', delayed.length);
        
        for (const id of active) {
            const job = await redis.hgetall('bull:campaign-execution-queue:' + id);
            console.log('Active Job ' + id + ' -> ' + JSON.parse(job.data).campaignId);
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
run();

