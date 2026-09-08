const { Client } = require('ssh2');
const fs = require('fs');

const conn = new Client();
conn.on('ready', () => {
  console.log('Connected to VPS.');
  conn.sftp((err, sftp) => {
    if (err) throw err;
    
    const localFile = 'c:\\Users\\farhan khalid\\OneDrive\\Pictures\\Documents\\Propnex\\propnexai-main-server\\src\\server\\queues\\campaign-execution.worker.ts';
    const remoteFile = '/root/propnexai-main-server/src/server/queues/campaign-execution.worker.ts';
    
    sftp.fastPut(localFile, remoteFile, (err) => {
      if (err) throw err;
      console.log('File uploaded successfully!');
      
      conn.exec(`cd /root/propnexai-main-server && npm run build && pm2 restart propnexai-main-server`, (err, stream) => {
        if (err) throw err;
        stream.on('close', (code) => {
          console.log('Build & Restart finished with code ' + code);
          conn.end();
        }).on('data', (data) => console.log('STDOUT: ' + data))
          .stderr.on('data', (data) => console.log('STDERR: ' + data));
      });
    });
  });
}).connect({
  host: '200.234.34.240',
  port: 22,
  username: 'root',
  password: 'Propnexai@123'
});
