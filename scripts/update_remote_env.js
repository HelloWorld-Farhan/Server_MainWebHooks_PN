const { Client } = require('ssh2');

const conn = new Client();

const commands = [
    // Update DATABASE_URL in .env to include replicaSet=rs0
    "sed -i 's/DATABASE_URL=\"mongodb:\\/\\/propnex_admin:Propnexai%40123@200.234.34.240:27017\\/propnex?authSource=admin\"/DATABASE_URL=\"mongodb:\\/\\/propnex_admin:Propnexai%40123@200.234.34.240:27017\\/propnex?authSource=admin\\&replicaSet=rs0\"/g' /var/www/propnexai-main-server/.env",
    "sed -i 's/DATABASE_URL=\"mongodb:\\/\\/propnex_admin:Propnexai%40123@200.234.34.240:27017\\/propnex?authSource=admin\"/DATABASE_URL=\"mongodb:\\/\\/propnex_admin:Propnexai%40123@200.234.34.240:27017\\/propnex?authSource=admin\\&replicaSet=rs0\"/g' /var/www/propnex-server/.env",
    
    // Restart PM2
    "cd /var/www/propnexai-main-server && pm2 restart all"
];

conn.on('ready', () => {
  console.log('SSH Client :: ready');
  let i = 0;
  function runNext() {
      if (i >= commands.length) {
          conn.end();
          return;
      }
      const cmd = commands[i++];
      console.log(`\n==================\nRunning: ${cmd}`);
      conn.exec(cmd, (err, stream) => {
          if (err) throw err;
          stream.on('close', (code) => {
            console.log('Stream :: close :: code: ' + code);
            runNext();
          }).on('data', (data) => console.log('STDOUT: ' + data))
            .stderr.on('data', (data) => console.log('STDERR: ' + data));
      });
  }
  runNext();
}).connect({
  host: '200.234.34.240',
  port: 22,
  username: 'root',
  password: 'Propnexai@123'
});
