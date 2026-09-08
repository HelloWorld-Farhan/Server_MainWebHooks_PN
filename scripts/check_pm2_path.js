const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  conn.exec(`pm2 jlist`, (err, stream) => {
    if (err) throw err;
    let dataOut = '';
    stream.on('close', (code) => {
      try {
        const procs = JSON.parse(dataOut);
        const propnex = procs.find(p => p.name === 'propnexai-main-server');
        if (propnex) console.log('Path: ' + propnex.pm2_env.pm_cwd);
      } catch (e) {
        console.log(dataOut);
      }
      conn.end();
    }).on('data', (data) => dataOut += data.toString());
  });
}).connect({
  host: '200.234.34.240',
  port: 22,
  username: 'root',
  password: 'Propnexai@123'
});
