const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  const script = `
    var cfg = rs.conf();
    cfg.members[0].host = "200.234.34.240:27017";
    rs.reconfig(cfg, {force: true});
    rs.status();
  `;
  conn.exec(`mongosh -u propnex_admin -p 'Propnexai@123' --authenticationDatabase admin --eval '${script.replace(/\n/g, ' ')}'`, (err, stream) => {
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
