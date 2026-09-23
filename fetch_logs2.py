import paramiko
import sys

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    ssh.connect('200.234.34.240', username='root', password='Propnexai@123', timeout=10)
    
    cmd = 'pm2 logs propnexai-main-server --lines 100 --nostream'
    print(f"--- Running command ---")
    stdin, stdout, stderr = ssh.exec_command(cmd)
    
    # Read the output ignoring decoding errors
    out = stdout.read()
    err = stderr.read()
    sys.stdout.buffer.write(out)
    sys.stderr.buffer.write(err)
        
finally:
    ssh.close()
