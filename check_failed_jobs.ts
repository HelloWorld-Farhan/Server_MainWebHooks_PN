
import Redis from 'ioredis';
const redis = new Redis('redis://:Propnexai@123@200.234.34.240:6379');
async function run() {
    try {
        const failed = await redis.lrange('bull:campaign-execution-queue:failed', 0, -1);
        console.log('Failed jobs:', failed.length);
        if (failed.length > 0) {
            const job = await redis.hgetall('bull:campaign-execution-queue:' + failed[0]);
            console.log('Job Error:', job.failedReason);
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
run();

