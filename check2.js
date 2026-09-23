require("dotenv").config();
const Redis = require("ioredis");
async function main() {
  const redis = new Redis(process.env.REDIS_URL);
  const keys = await redis.keys("campaign-state:*");
  for (const k of keys) {
    if (k.includes("paused")) continue;
    const stateStr = await redis.get(k);
    if (!stateStr) continue;
    let state = JSON.parse(stateStr);
    if (state.isReactivation) {
      console.log(k, "-> status:", state.status, "qStage:", state.qStage, "completed:", state.completedCalls, "total:", state.totalContacts);
    }
  }
  await redis.quit();
}
main();
