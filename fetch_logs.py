import paramiko
import sys

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    ssh.connect('200.234.34.240', username='root', password='Propnexai@123', timeout=10)
    
    # Just grep the pm2 logs for "Skipping lead" or "Failed to push lead"
    cmd = 'cat /root/.pm2/logs/propnexai-backend-out.log /root/.pm2/logs/propnexai-backend-error.log | grep -E "Skipping lead|Failed to push lead" | tail -n 20'
    print(f"--- Running command ---")
    stdin, stdout, stderr = ssh.exec_command(cmd)
    print(stdout.read().decode())
    print(stderr.read().decode())
        
finally:
    ssh.close()
