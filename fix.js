const fs = require('fs');
let c = fs.readFileSync('src/server/queues/campaign-execution.worker.ts', 'utf8');
c = c.split('\campaign-state:\\').join('redisKey');
fs.writeFileSync('src/server/queues/campaign-execution.worker.ts', c);
