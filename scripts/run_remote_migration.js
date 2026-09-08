const { Client } = require('ssh2');
const fs = require('fs');

const conn = new Client();
const scriptContent = fs.readFileSync('./scripts/migrate_mongodb.js', 'utf8');
const base64Script = Buffer.from(scriptContent).toString('base64');

conn.on('ready', () => {
  console.log('SSH Client :: ready');
  conn.exec(`mkdir -p /tmp/mongo_migrate && cd /tmp/mongo_migrate && npm install mongodb && node -e "$(echo '${base64Script}' | base64 -d)"`, (err, stream) => {
      if (err) throw err;
      stream.on('close', (code, signal) => {
        console.log('Migration finished with code ' + code);
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
