const { Client } = require('ssh2');

const conn = new Client();

const commands = [
    // 1. Add replication to mongod.conf
    "grep -q 'replSetName' /etc/mongod.conf || echo -e 'replication:\n  replSetName: \"rs0\"' >> /etc/mongod.conf",
    
    // 2. Restart MongoDB
    "systemctl restart mongod",
    
    // 3. Wait for it to come up
    "sleep 3",
    
    // 4. Initiate the replica set (only if not already initiated)
    "mongosh -u propnex_admin -p 'Propnexai@123' --authenticationDatabase admin --eval 'rs.initiate()' || true"
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
