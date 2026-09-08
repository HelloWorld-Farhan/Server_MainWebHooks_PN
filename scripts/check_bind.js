const { Client } = require('ssh2');

const conn = new Client();

conn.on('ready', () => {
  console.log('SSH Client :: ready');
  conn.exec(`cat /etc/mongod.conf | grep bindIp`, (err, stream) => {
      if (err) throw err;
      stream.on('close', (code) => {
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
