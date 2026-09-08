const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  conn.exec(`grep -q "AUTO-REACTIVATION" /root/propnexai-main-server/src/server/queues/campaign-execution.worker.ts && echo "YES" || echo "NO"`, (err, stream) => {
    if (err) throw err;
    stream.on('close', (code) => {
      conn.end();
    }).on('data', (data) => console.log(data.toString().trim()))
      .stderr.on('data', (data) => console.error(data.toString()));
  });
}).connect({
  host: '200.234.34.240',
  port: 22,
  username: 'root',
  password: 'Propnexai@123'
});
