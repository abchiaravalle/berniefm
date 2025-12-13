#!/usr/bin/env python3
"""
BC Radio DigitalOcean Management Script
Manage, monitor, and scale your BC Radio deployment on DigitalOcean.
"""

import json
import subprocess
import sys
import argparse
import time
from datetime import datetime, timedelta
from pathlib import Path

class DOManager:
    def __init__(self, config_file="do-config.json"):
        self.config_file = config_file
        self.config = self.load_config()
    
    def load_config(self):
        """Load DigitalOcean configuration"""
        config_path = Path(self.config_file)
        if not config_path.exists():
            self.error(f"Configuration file {self.config_file} not found")
            self.error("Run ./setup-digitalocean.sh first")
            sys.exit(1)
        
        try:
            with open(config_path, 'r') as f:
                return json.load(f)
        except Exception as e:
            self.error(f"Error loading config: {e}")
            sys.exit(1)
    
    def run_command(self, cmd, capture_output=True):
        """Run shell command and return result"""
        try:
            result = subprocess.run(
                cmd, shell=True, capture_output=capture_output, 
                text=True, check=True
            )
            return result.stdout.strip() if capture_output else None
        except subprocess.CalledProcessError as e:
            if capture_output:
                self.error(f"Command failed: {cmd}")
                self.error(f"Error: {e.stderr}")
            return None
    
    def success(self, msg):
        print(f"\033[92m[SUCCESS]\033[0m {msg}")
    
    def info(self, msg):
        print(f"\033[94m[INFO]\033[0m {msg}")
    
    def warning(self, msg):
        print(f"\033[93m[WARNING]\033[0m {msg}")
    
    def error(self, msg):
        print(f"\033[91m[ERROR]\033[0m {msg}")
    
    def api(self, msg):
        print(f"\033[95m[API]\033[0m {msg}")
    
    def get_droplet_info(self):
        """Get current droplet information"""
        droplet_id = self.config.get('droplet', {}).get('id')
        if not droplet_id:
            self.error("No droplet ID found in configuration")
            return None
        
        cmd = f"doctl compute droplet get {droplet_id} --format ID,Name,Status,PublicIPv4,PrivateIPv4,Memory,VCPUs,Disk,Region --output json"
        result = self.run_command(cmd)
        
        if result:
            try:
                return json.loads(result)[0]
            except (json.JSONDecodeError, IndexError):
                return None
        return None
    
    def status(self):
        """Show deployment status"""
        self.info("BC Radio DigitalOcean Status")
        print("=" * 40)
        
        # Droplet status
        droplet_info = self.get_droplet_info()
        if droplet_info:
            print(f"🖥️  Droplet: {droplet_info['name']} ({droplet_info['id']})")
            print(f"   Status: {droplet_info['status']}")
            print(f"   IP: {droplet_info['public_ipv4']}")
            print(f"   Region: {droplet_info['region']['slug']}")
            print(f"   Size: {droplet_info['vcpus']} vCPUs, {droplet_info['memory']}MB RAM, {droplet_info['disk']}GB disk")
        else:
            self.error("Could not get droplet information")
        
        # Domain status
        domain = self.config.get('domain')
        if domain:
            print(f"🌐 Domain: {domain}")
            
            # Check DNS resolution
            try:
                import socket
                ip = socket.gethostbyname(domain)
                print(f"   DNS: Resolves to {ip}")
                
                if droplet_info and ip == droplet_info['public_ipv4']:
                    print("   ✅ DNS correctly points to droplet")
                else:
                    print("   ⚠️  DNS does not point to droplet")
            except socket.gaierror:
                print("   ❌ DNS not resolved")
        
        # Service status
        self.check_services()
        
        # Cost estimate
        self.show_cost_estimate()
    
    def check_services(self):
        """Check service health"""
        print("\n🔍 Service Health:")
        
        droplet_ip = self.config.get('droplet', {}).get('reserved_ip') or \
                    self.config.get('droplet', {}).get('ip')
        domain = self.config.get('domain')
        
        if not droplet_ip:
            self.error("No droplet IP found")
            return
        
        # Test endpoints
        endpoints = [
            (f"https://{domain}", "Web Interface"),
            (f"https://{domain}/admin", "Admin Panel"),
            (f"https://{domain}/api/nowplaying", "API"),
            (f"https://stream.{domain}/listen", "Stream")
        ]
        
        for url, name in endpoints:
            try:
                result = self.run_command(f"curl -s -o /dev/null -w '%{{http_code}}' --max-time 10 {url}")
                if result and result.startswith('2'):
                    print(f"   ✅ {name}: OK ({result})")
                else:
                    print(f"   ❌ {name}: Failed ({result})")
            except:
                print(f"   ❌ {name}: Connection failed")
    
    def show_cost_estimate(self):
        """Show monthly cost estimate"""
        print("\n💰 Monthly Cost Estimate:")
        
        droplet_size = self.config.get('droplet', {}).get('size', 'unknown')
        
        costs = {
            's-1vcpu-1gb': 6,
            's-2vcpu-4gb': 24,
            's-4vcpu-8gb': 48,
            's-8vcpu-16gb': 96
        }
        
        droplet_cost = costs.get(droplet_size, 0)
        reserved_ip_cost = 4
        backup_cost = int(droplet_cost * 0.2)
        
        print(f"   Droplet ({droplet_size}): ${droplet_cost}/month")
        print(f"   Reserved IP: ${reserved_ip_cost}/month")
        print(f"   Backups: ${backup_cost}/month")
        print(f"   Total: ${droplet_cost + reserved_ip_cost + backup_cost}/month")
    
    def logs(self, service=None, lines=50):
        """View application logs"""
        droplet_ip = self.config.get('droplet', {}).get('reserved_ip') or \
                    self.config.get('droplet', {}).get('ip')
        
        if not droplet_ip:
            self.error("No droplet IP found")
            return
        
        self.info(f"Fetching logs from {droplet_ip}...")
        
        if service:
            cmd = f"ssh -o StrictHostKeyChecking=no root@{droplet_ip} 'docker-compose logs --tail {lines} {service}'"
        else:
            cmd = f"ssh -o StrictHostKeyChecking=no root@{droplet_ip} 'docker-compose logs --tail {lines}'"
        
        self.run_command(cmd, capture_output=False)
    
    def restart(self, service=None):
        """Restart services"""
        droplet_ip = self.config.get('droplet', {}).get('reserved_ip') or \
                    self.config.get('droplet', {}).get('ip')
        
        if not droplet_ip:
            self.error("No droplet IP found")
            return
        
        if service:
            self.info(f"Restarting {service}...")
            cmd = f"ssh -o StrictHostKeyChecking=no root@{droplet_ip} 'docker-compose restart {service}'"
        else:
            self.info("Restarting all services...")
            cmd = f"ssh -o StrictHostKeyChecking=no root@{droplet_ip} 'docker-compose restart'"
        
        result = self.run_command(cmd)
        if result is not None:
            self.success("Services restarted successfully")
        else:
            self.error("Failed to restart services")
    
    def backup(self):
        """Create backup of configuration and data"""
        self.info("Creating backup...")
        
        droplet_id = self.config.get('droplet', {}).get('id')
        if not droplet_id:
            self.error("No droplet ID found")
            return
        
        # Create droplet snapshot
        timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        snapshot_name = f"bc-radio-backup-{timestamp}"
        
        self.api(f"Creating droplet snapshot: {snapshot_name}")
        cmd = f"doctl compute droplet-action snapshot {droplet_id} --snapshot-name {snapshot_name} --wait"
        
        result = self.run_command(cmd)
        if result is not None:
            self.success(f"Backup snapshot created: {snapshot_name}")
            
            # Update config with backup info
            if 'backups' not in self.config:
                self.config['backups'] = []
            
            self.config['backups'].append({
                'name': snapshot_name,
                'date': timestamp,
                'type': 'snapshot'
            })
            
            self.save_config()
        else:
            self.error("Failed to create backup")
    
    def scale(self, new_size):
        """Scale droplet to new size"""
        droplet_id = self.config.get('droplet', {}).get('id')
        if not droplet_id:
            self.error("No droplet ID found")
            return
        
        current_size = self.config.get('droplet', {}).get('size')
        
        if new_size == current_size:
            self.warning(f"Droplet is already size {new_size}")
            return
        
        self.info(f"Scaling droplet from {current_size} to {new_size}...")
        self.warning("This will restart your droplet!")
        
        response = input("Continue? (y/N): ")
        if response.lower() != 'y':
            self.info("Scaling cancelled")
            return
        
        # Power off droplet first
        self.api("Powering off droplet...")
        self.run_command(f"doctl compute droplet-action power-off {droplet_id} --wait")
        
        # Resize droplet
        self.api(f"Resizing to {new_size}...")
        cmd = f"doctl compute droplet-action resize {droplet_id} --size {new_size} --wait"
        
        result = self.run_command(cmd)
        if result is not None:
            # Power on droplet
            self.api("Powering on droplet...")
            self.run_command(f"doctl compute droplet-action power-on {droplet_id} --wait")
            
            # Update config
            self.config['droplet']['size'] = new_size
            self.save_config()
            
            self.success(f"Droplet scaled to {new_size}")
        else:
            self.error("Failed to scale droplet")
    
    def monitor(self, duration=300):
        """Monitor services for specified duration (seconds)"""
        self.info(f"Monitoring services for {duration} seconds...")
        
        start_time = time.time()
        check_interval = 30  # Check every 30 seconds
        
        while time.time() - start_time < duration:
            print(f"\n🔍 Check at {datetime.now().strftime('%H:%M:%S')}")
            self.check_services()
            
            if time.time() - start_time < duration:
                time.sleep(check_interval)
        
        self.info("Monitoring complete")
    
    def update_deployment(self):
        """Update BC Radio deployment"""
        droplet_ip = self.config.get('droplet', {}).get('reserved_ip') or \
                    self.config.get('droplet', {}).get('ip')
        
        if not droplet_ip:
            self.error("No droplet IP found")
            return
        
        self.info("Updating BC Radio deployment...")
        
        # Create update package
        self.info("Creating update package...")
        self.run_command("tar -czf bc-radio-update.tar.gz --exclude='music' --exclude='azuracast_*' --exclude='*.tar.gz' --exclude='.git' --exclude='node_modules' --exclude='dist' .")
        
        # Copy to droplet
        self.api("Uploading update...")
        self.run_command(f"scp -o StrictHostKeyChecking=no bc-radio-update.tar.gz root@{droplet_ip}:/root/")
        
        # Execute update
        self.api("Executing update on droplet...")
        update_script = """
set -e
cd /root
tar -xzf bc-radio-update.tar.gz
chmod +x *.sh *.py
python3 build.py
sudo systemctl reload caddy
docker-compose pull
docker-compose up -d
echo "Update complete!"
"""
        
        cmd = f"ssh -o StrictHostKeyChecking=no root@{droplet_ip} '{update_script}'"
        result = self.run_command(cmd, capture_output=False)
        
        # Clean up
        self.run_command("rm -f bc-radio-update.tar.gz")
        
        self.success("Deployment updated successfully")
    
    def destroy(self, confirm=False):
        """Destroy all DigitalOcean resources"""
        if not confirm:
            self.warning("This will destroy ALL BC Radio resources on DigitalOcean!")
            print("This includes:")
            print("• Droplet and all data")
            print("• Reserved IP")
            print("• Firewall rules")
            print("• Backups and snapshots")
            print("")
            response = input("Type 'yes' to confirm destruction: ")
            if response != 'yes':
                self.info("Destruction cancelled")
                return
        
        droplet_id = self.config.get('droplet', {}).get('id')
        firewall_id = self.config.get('firewall', {}).get('id')
        
        # Delete droplet
        if droplet_id:
            self.api(f"Deleting droplet {droplet_id}...")
            self.run_command(f"doctl compute droplet delete {droplet_id} --force")
        
        # Delete firewall
        if firewall_id:
            self.api(f"Deleting firewall {firewall_id}...")
            self.run_command(f"doctl compute firewall delete {firewall_id} --force")
        
        # Remove config file
        if Path(self.config_file).exists():
            Path(self.config_file).unlink()
        
        self.success("All resources destroyed")
    
    def save_config(self):
        """Save configuration to file"""
        try:
            with open(self.config_file, 'w') as f:
                json.dump(self.config, f, indent=2)
        except Exception as e:
            self.error(f"Error saving config: {e}")

def main():
    parser = argparse.ArgumentParser(description="BC Radio DigitalOcean Management")
    parser.add_argument('--config', default='do-config.json', help='Configuration file')
    
    subparsers = parser.add_subparsers(dest='command', help='Available commands')
    
    # Status command
    subparsers.add_parser('status', help='Show deployment status')
    
    # Logs command
    logs_parser = subparsers.add_parser('logs', help='View application logs')
    logs_parser.add_argument('--service', help='Specific service to view logs for')
    logs_parser.add_argument('--lines', type=int, default=50, help='Number of lines to show')
    
    # Restart command
    restart_parser = subparsers.add_parser('restart', help='Restart services')
    restart_parser.add_argument('--service', help='Specific service to restart')
    
    # Backup command
    subparsers.add_parser('backup', help='Create backup snapshot')
    
    # Scale command
    scale_parser = subparsers.add_parser('scale', help='Scale droplet size')
    scale_parser.add_argument('size', help='New droplet size (e.g., s-4vcpu-8gb)')
    
    # Monitor command
    monitor_parser = subparsers.add_parser('monitor', help='Monitor services')
    monitor_parser.add_argument('--duration', type=int, default=300, help='Duration in seconds')
    
    # Update command
    subparsers.add_parser('update', help='Update BC Radio deployment')
    
    # Destroy command
    destroy_parser = subparsers.add_parser('destroy', help='Destroy all resources')
    destroy_parser.add_argument('--confirm', action='store_true', help='Skip confirmation')
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        return
    
    manager = DOManager(args.config)
    
    if args.command == 'status':
        manager.status()
    elif args.command == 'logs':
        manager.logs(args.service, args.lines)
    elif args.command == 'restart':
        manager.restart(args.service)
    elif args.command == 'backup':
        manager.backup()
    elif args.command == 'scale':
        manager.scale(args.size)
    elif args.command == 'monitor':
        manager.monitor(args.duration)
    elif args.command == 'update':
        manager.update_deployment()
    elif args.command == 'destroy':
        manager.destroy(args.confirm)

if __name__ == "__main__":
    main()