const { Client } = require('ssh2');
const fs = require('fs');
const { execSync } = require('child_process');

// 1. Zip the dist folder locally
console.log('Zipping dist folder...');
try {
  execSync('powershell Compress-Archive -Path dist -DestinationPath dist.zip -Force');
  console.log('Zip created successfully.');
} catch (err) {
  console.error('Failed to create zip:', err);
  process.exit(1);
}

const host = '200.234.34.240';
const username = 'root';
const password = 'Propnexai@123';

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH Client ready');
  conn.sftp((err, sftp) => {
    if (err) throw err;
    console.log('Uploading dist.zip...');
    sftp.fastPut('dist.zip', '/root/propnexai-main-server/dist.zip', (err) => {
      if (err) throw err;
      console.log('Upload finished!');
      
      const commands = `
        cd /root/propnexai-main-server
        rm -rf dist
        apt-get install unzip -y || true
        unzip -o dist.zip
        pm2 restart propnexai-main-server
      `;
      conn.exec(commands, (err, stream) => {
        if (err) throw err;
        stream.on('close', () => {
          console.log('Restarted server successfully!');
          conn.end();
        }).on('data', d => process.stdout.write(d)).stderr.on('data', d => process.stderr.write(d));
      });
    });
  });
}).connect({
  host: host,
  username: username,
  password: password,
  readyTimeout: 60000
});
