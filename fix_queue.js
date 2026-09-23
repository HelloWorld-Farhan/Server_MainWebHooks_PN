const fs = require('fs');
let c = fs.readFileSync('src/server/queues/campaign-execution.queue.ts', 'utf8');
c = c.replace(
  'const pausedState = { ...reactState, status: "paused" };',
  'const pausedState = { ...reactState, status: "paused", pausedBy: "campaign" };'
);
fs.writeFileSync('src/server/queues/campaign-execution.queue.ts', c);
