const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`mongosh -u propnex_admin -p 'Propnexai@123' --authenticationDatabase admin --eval 'rs.status()'`, (err, stream) => {
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
