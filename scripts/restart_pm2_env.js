const { Client } = require('ssh2');

const conn = new Client();

const commands = [
    // Restart PM2 and update env variables
    "cd /var/www/propnexai-main-server && pm2 restart all --update-env"
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
