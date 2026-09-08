const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  console.log('Connected, flushing logs...');
  conn.exec(`pm2 flush && npm cache clean --force && rm -rf /root/.pm2/logs/*`, (err, stream) => {
    if (err) throw err;
    stream.on('close', (code) => {
      console.log('Done!');
      conn.end();
    }).on('data', (data) => console.log(data.toString()))
      .stderr.on('data', (data) => console.error(data.toString()));
  });
}).connect({
  host: '200.234.34.240',
  port: 22,
  username: 'root',
  password: 'Propnexai@123'
});
