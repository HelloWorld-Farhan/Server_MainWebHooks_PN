const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.sftp((err, sftp) => {
    if (err) throw err;
    const localPath = 'c:/Users/farhan khalid/OneDrive/Pictures/Documents/Propnex/propnexai-main-server/dist.zip';
    const remotePath = '/root/propnexai-main-server/dist.zip';
    console.log('Uploading dist.zip...');
    sftp.fastPut(localPath, remotePath, (err) => {
      if (err) throw err;
      console.log('Upload complete! Extracting...');
      conn.exec('cd /root/propnexai-main-server && unzip -o dist.zip && pm2 restart propnexai-main-server', (err, stream) => {
        stream.on('close', () => {
          conn.exec('sleep 2 && pm2 logs propnexai-main-server --lines 10 --nostream', (e, s) => {
            s.on('close', () => conn.end())
             .on('data', d => process.stdout.write(d))
             .stderr.on('data', d => process.stderr.write(d));
          });
        })
        .on('data', d => process.stdout.write(d))
        .stderr.on('data', d => process.stderr.write(d));
      });
    });
  });
}).connect({
  host: '200.234.34.240',
  port: 22,
  username: 'root',
  password: 'Propnexai@123'
});
