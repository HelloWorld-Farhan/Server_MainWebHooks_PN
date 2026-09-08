const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  console.log('Connected to VPS.');
  conn.exec(`cd /root/propnexai-main-server && git pull && npm run build && pm2 restart propnexai-main-server`, (err, stream) => {
    if (err) throw err;
    stream.on('close', (code) => {
      console.log('VPS Deploy finished with code ' + code);
      conn.end();
    }).on('data', (data) => console.log('STDOUT: ' + data))
      .stderr.on('data', (data) => console.log('STDERR: ' + data));
  });
}).connect({
  host: '200.234.34.240',
  port: 22,
  username: 'root',
  password: 'Propnexai@123'
});
