
import Redis from 'ioredis';
const redis = new Redis('redis://:Propnexai@123@200.234.34.240:6379');
async function run() {
    try {
        const completed = await redis.lrange('bull:campaign-execution-queue:completed', 0, -1);
        for (const id of completed) {
            const job = await redis.hgetall('bull:campaign-execution-queue:' + id);
            if (job.data) {
                const data = JSON.parse(job.data);
                if (data.campaignId === 'reactivation-2026-09-19-6a8bed4d-350798-q2') {
                    console.log('Q2 Job ID:', id);
                    console.log('Leads length:', data.leads.length);
                    if (job.returnvalue) console.log('Return value:', job.returnvalue.slice(0, 100));
                }
            }
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
run();

