const { Client } = require('ssh2'); 
const conn = new Client(); 
conn.on('ready', () => { 
  conn.exec('grep -i "webhook" /root/.pm2/logs/propnexai-main-server-*.log | tail -n 50', (err, stream) => { 
    if (err) throw err; 
    stream.on('close', () => conn.end())
          .on('data', (d) => process.stdout.write(d))
          .stderr.on('data', (d) => process.stderr.write(d)); 
  }); 
}).connect({ host: '200.234.34.240', port: 22, username: 'root', password: 'Propnexai@123' });
