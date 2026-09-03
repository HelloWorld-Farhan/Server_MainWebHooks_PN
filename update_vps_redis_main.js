const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  console.log('Client :: ready');
      // Now update the main server
      conn.exec(`sed -i 's|UPSTASH_REDIS_URL=.*|REDIS_URL="redis://:Propnexai@123@200.234.34.240:6379"|g' /root/propnexai-main-server/.env && sed -i 's|REDIS_URL=.*|REDIS_URL="redis://:Propnexai@123@200.234.34.240:6379"|g' /root/propnexai-main-server/.env && pm2 restart propnexai-main-server`, (err2, stream2) => {
        if (err2) throw err2;
        stream2.on('close', (code2, signal2) => {
          console.log('Stream2 :: close :: code: ' + code2 + ', signal: ' + signal2);
          conn.end();
        }).on('data', (data) => {
          console.log('STDOUT: ' + data);
        }).stderr.on('data', (data) => {
          console.log('STDERR: ' + data);
        });
      });
}).connect({
  host: '200.234.34.240',
  port: 22,
  username: 'root',
  password: 'Propnexai@123'
});
