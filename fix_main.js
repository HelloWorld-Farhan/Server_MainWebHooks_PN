const fs = require('fs');
let c = fs.readFileSync('src/main.ts', 'utf8');

const recoveryLogic = \
    // Auto-Pause running campaigns on Server Restart so user explicitly knows it was interrupted
    if (redisConnection) {
      try {
        const keys = await redisConnection.keys('campaign-state:*');
        for (const key of keys) {
          const stateStr = await redisConnection.get(key);
          if (stateStr) {
            const state = JSON.parse(stateStr);
            if (state.status === 'running') {
              console.log(\[Startup Recovery] Pausing interrupted campaign \ due to Server Restart\);
              await redisConnection.set(key, JSON.stringify({ ...state, status: 'paused', pausedBy: 'server' }));
            }
          }
        }
      } catch (err) {
        console.error('[Startup Recovery] Failed to auto-pause campaigns', err);
      }
    }
\;

c = c.replace(
  'const now = new Date();',
  recoveryLogic + '\n    const now = new Date();'
);

fs.writeFileSync('src/main.ts', c);
