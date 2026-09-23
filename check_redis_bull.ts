
import Redis from 'ioredis';
const redis = new Redis('redis://localhost:6379');
async function run() {
    const keys = await redis.keys('bull:campaign-execution-queue:*');
    console.log(keys);
    
    // get active
    const active = await redis.lrange('bull:campaign-execution-queue:active', 0, -1);
    console.log('Active jobs:', active);
    
    for (const id of active) {
        const job = await redis.hgetall('bull:campaign-execution-queue:' + id);
        console.log('Job ' + id, 'data:', job.data?.slice(0, 100));
    }
    process.exit(0);
}
run();

