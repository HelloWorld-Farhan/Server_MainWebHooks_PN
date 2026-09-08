const { Client } = require('ssh2');

const conn = new Client();

const commands = [
    "sudo apt-get install gnupg curl -y",
    "curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor --yes",
    "echo 'deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse' | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list",
    "sudo apt-get update",
    "sudo apt-get install -y mongodb-org",
    "sudo systemctl enable mongod",
    "sudo systemctl start mongod",
    "sleep 5", // wait for mongo to start
    "mongosh admin --eval 'db.createUser({user: \"propnex_admin\", pwd: \"Propnexai@123\", roles: [{role: \"root\", db: \"admin\"}]})'",
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
          stream.on('close', (code, signal) => {
            console.log('Stream :: close :: code: ' + code + ', signal: ' + signal);
            runNext();
          }).on('data', (data) => {
            console.log('STDOUT: ' + data);
          }).stderr.on('data', (data) => {
            console.log('STDERR: ' + data);
          });
      });
  }
  
  runNext();
  
}).connect({
  host: '200.234.34.240',
  port: 22,
  username: 'root',
  password: 'Propnexai@123'
});
