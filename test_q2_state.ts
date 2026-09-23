
import Redis from 'ioredis';
const redis = new Redis('redis://:Propnexai@123@200.234.34.240:6379');
async function run() {
    try {
        const state = await redis.get('campaign-state:6a8bed4d3f5b7c2eea48418e');
        console.log('State:', state);
        
        // Find if there is any other campaign-state key
        const keys = await redis.keys('campaign-state:*');
        console.log('All campaign state keys:', keys);
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
run();

