# BC Radio DigitalOcean Deployment Guide

Complete guide for deploying BC Radio on DigitalOcean with automated infrastructure management.

## 🌊 Overview

The DigitalOcean deployment provides a fully automated solution that creates and configures:

- **Ubuntu 22.04 Droplet** with optimized configuration
- **Reserved Static IP** for consistent domain pointing
- **Cloud Firewall** with proper security rules
- **Automatic Backups** for data protection
- **SSL Certificates** via Let's Encrypt
- **Monitoring** and alerting
- **Project Organization** for resource management

## 🚀 Quick Start

### Prerequisites

1. **DigitalOcean Account**: [Sign up here](https://cloud.digitalocean.com/)
2. **API Token**: [Create one here](https://cloud.digitalocean.com/account/api/tokens)
3. **Domain Name**: Either purchase through DO or use external registrar
4. **doctl CLI**: DigitalOcean command-line tool

### Installation

```bash
# Install doctl (DigitalOcean CLI)
# macOS
brew install doctl

# Ubuntu/Debian
sudo snap install doctl

# CentOS/RHEL/Fedora
sudo dnf install doctl

# Manual installation
curl -sL https://github.com/digitalocean/doctl/releases/download/v1.94.0/doctl-1.94.0-linux-amd64.tar.gz | tar -xzv
sudo mv doctl /usr/local/bin
```

### One-Command Deployment

```bash
# Run the automated setup
./setup-digitalocean.sh

# Follow the interactive prompts:
# 1. Enter DigitalOcean API token
# 2. Specify domain name
# 3. Choose region and droplet size
# 4. Wait for deployment completion
```

## 📋 Deployment Process

### Step 1: Authentication
- Validates API token
- Sets up doctl authentication
- Verifies account access

### Step 2: Configuration
- Prompts for domain name
- Selects droplet region and size
- Creates/uploads SSH keys
- Generates configuration file

### Step 3: Infrastructure Creation
- Creates DigitalOcean project
- Sets up cloud firewall rules
- Creates optimized droplet
- Assigns reserved IP address

### Step 4: Application Deployment
- Installs Docker and dependencies
- Deploys BC Radio application
- Configures Caddy reverse proxy
- Sets up automatic SSL

### Step 5: Final Configuration
- Builds static frontend
- Configures AzuraCast
- Tests all endpoints
- Provides DNS instructions

## ⚙️ Configuration Options

### Droplet Sizes

| Size | vCPUs | RAM | Disk | Monthly Cost | Recommended For |
|------|-------|-----|------|--------------|-----------------|
| s-1vcpu-1gb | 1 | 1GB | 25GB | $6 | Testing only |
| s-2vcpu-4gb | 2 | 4GB | 80GB | $24 | Small audience |
| s-4vcpu-8gb | 4 | 8GB | 160GB | $48 | Medium audience |
| s-8vcpu-16gb | 8 | 16GB | 320GB | $96 | Large audience |

### Regions

Choose based on your primary audience location:

| Region | Location | Code |
|--------|----------|------|
| New York | USA East Coast | nyc1, nyc3 |
| San Francisco | USA West Coast | sfo3 |
| Toronto | Canada | tor1 |
| London | UK | lon1 |
| Amsterdam | Netherlands | ams3 |
| Frankfurt | Germany | fra1 |
| Singapore | Asia Pacific | sgp1 |
| Bangalore | India | blr1 |

### Firewall Rules

Automatically configured rules:

| Port | Protocol | Purpose |
|------|----------|---------|
| 22 | TCP | SSH access |
| 80 | TCP | HTTP (redirects to HTTPS) |
| 443 | TCP | HTTPS |
| 8000-8999 | TCP | Streaming ports |

## 🛠️ Management Commands

### Status and Monitoring

```bash
# Check overall deployment status
python3 do-manage.py status

# Monitor services continuously
python3 do-manage.py monitor --duration 600

# Check specific service logs
python3 do-manage.py logs --service azuracast --lines 100
```

### Service Management

```bash
# Restart all services
python3 do-manage.py restart

# Restart specific service
python3 do-manage.py restart --service caddy

# View real-time logs
python3 do-manage.py logs
```

### Backup and Recovery

```bash
# Create snapshot backup
python3 do-manage.py backup

# List available backups
doctl compute snapshot list

# Restore from backup (create new droplet from snapshot)
doctl compute droplet create bc-radio-restored \
  --image snapshot-id \
  --region nyc1 \
  --size s-2vcpu-4gb
```

### Scaling

```bash
# Scale to larger droplet
python3 do-manage.py scale s-4vcpu-8gb

# Scale to smaller droplet (data preserved)
python3 do-manage.py scale s-2vcpu-4gb
```

### Updates

```bash
# Update BC Radio deployment
python3 do-manage.py update

# Manual update process
ssh root@your-droplet-ip
cd /root
git pull  # if using git
python3 build.py
sudo systemctl reload caddy
docker-compose pull && docker-compose up -d
```

## 🌐 DNS Configuration

After deployment, configure your domain's DNS:

### Option 1: DigitalOcean DNS (Recommended)

```bash
# Add domain to DigitalOcean
doctl compute domain create yourdomain.com

# Add A record pointing to your droplet IP
doctl compute domain records create yourdomain.com \
  --record-type A \
  --record-name @ \
  --record-data YOUR_DROPLET_IP

# Add CNAME for www
doctl compute domain records create yourdomain.com \
  --record-type CNAME \
  --record-name www \
  --record-data yourdomain.com
```

### Option 2: External DNS Provider

Add these records to your DNS provider:

```
Type: A
Name: @ (or blank)
Value: YOUR_DROPLET_IP
TTL: 300

Type: CNAME
Name: www
Value: yourdomain.com
TTL: 300
```

## 🔒 Security Best Practices

### Firewall Configuration

The setup automatically configures:
- Cloud firewall with minimal required ports
- SSH key-based authentication only
- Automatic security updates
- Fail2ban for intrusion prevention

### SSL/TLS

- Automatic SSL certificate generation via Let's Encrypt
- HTTP to HTTPS redirects
- Strong cipher suites
- HSTS headers

### Access Control

```bash
# Change SSH port (optional)
ssh root@your-droplet-ip
sed -i 's/#Port 22/Port 2222/' /etc/ssh/sshd_config
systemctl restart sshd

# Update firewall for new SSH port
doctl compute firewall add-rules your-firewall-id \
  --inbound-rules "protocol:tcp,ports:2222,address:0.0.0.0/0"
doctl compute firewall remove-rules your-firewall-id \
  --inbound-rules "protocol:tcp,ports:22,address:0.0.0.0/0"
```

## 📊 Monitoring and Alerts

### Built-in Monitoring

DigitalOcean provides:
- CPU, memory, and disk usage graphs
- Bandwidth monitoring
- Uptime tracking
- Email alerts for resource thresholds

### Custom Monitoring

```bash
# Install additional monitoring (optional)
ssh root@your-droplet-ip

# Install Netdata for real-time monitoring
bash <(curl -Ss https://my-netdata.io/kickstart.sh)

# Access at https://yourdomain.com:19999
```

### Log Management

```bash
# Centralized logging with rsyslog
ssh root@your-droplet-ip
echo "*.* @@logs.papertrailapp.com:PORT" >> /etc/rsyslog.conf
systemctl restart rsyslog
```

## 🔧 Troubleshooting

### Common Issues

#### 1. Deployment Fails

```bash
# Check API token
doctl auth list

# Verify account limits
doctl account get

# Check region availability
doctl compute region list
```

#### 2. DNS Not Resolving

```bash
# Check DNS propagation
dig yourdomain.com
nslookup yourdomain.com

# Verify DNS records
doctl compute domain records list yourdomain.com
```

#### 3. SSL Certificate Issues

```bash
# Check Caddy logs
ssh root@your-droplet-ip
journalctl -u caddy -f

# Manually trigger certificate renewal
caddy reload --config /etc/caddy/Caddyfile
```

#### 4. Stream Not Working

```bash
# Check AzuraCast status
python3 do-manage.py status

# Restart AzuraCast
python3 do-manage.py restart --service azuracast

# Check firewall rules
doctl compute firewall list
```

### Log Locations

```bash
# Caddy logs
/var/log/caddy/bc-radio.log

# AzuraCast logs
docker-compose logs azuracast

# System logs
journalctl -f
```

### Performance Optimization

#### Database Tuning

```bash
# Optimize MySQL for your droplet size
ssh root@your-droplet-ip
docker-compose exec azuracast mysql -u root -p

# For 4GB+ droplets
SET GLOBAL innodb_buffer_pool_size = 1073741824;  # 1GB
SET GLOBAL max_connections = 200;
```

#### Caching

```bash
# Enable Redis caching
ssh root@your-droplet-ip
docker-compose exec azuracast redis-cli ping
```

## 💰 Cost Optimization

### Right-sizing

```bash
# Monitor resource usage
python3 do-manage.py monitor --duration 3600

# Scale down if underutilized
python3 do-manage.py scale s-1vcpu-2gb

# Scale up during peak times
python3 do-manage.py scale s-4vcpu-8gb
```

### Backup Strategy

```bash
# Weekly snapshots (automated)
# Keep 4 weeks of backups
doctl compute snapshot list | grep bc-radio | head -n -4 | \
  awk '{print $1}' | xargs -I {} doctl compute snapshot delete {}
```

### Reserved IP Management

```bash
# Only keep reserved IP if needed
# Remove if using load balancer
doctl compute reserved-ip delete YOUR_RESERVED_IP
```

## 🔄 Disaster Recovery

### Backup Strategy

1. **Automated Snapshots**: Weekly droplet snapshots
2. **Configuration Backup**: `do-config.json` stored locally
3. **Data Export**: Regular AzuraCast database exports
4. **Code Repository**: Git repository for application code

### Recovery Process

```bash
# 1. Create new droplet from snapshot
doctl compute droplet create bc-radio-recovery \
  --image snapshot-id \
  --region nyc1 \
  --size s-2vcpu-4gb \
  --ssh-keys your-ssh-key-id

# 2. Update DNS to point to new droplet
doctl compute domain records update yourdomain.com record-id \
  --record-data NEW_DROPLET_IP

# 3. Verify services
python3 do-manage.py status --config recovery-config.json
```

## 📈 Scaling Strategies

### Vertical Scaling

```bash
# Scale up for more resources
python3 do-manage.py scale s-8vcpu-16gb
```

### Horizontal Scaling

```bash
# Load balancer setup
doctl compute load-balancer create bc-radio-lb \
  --name bc-radio-lb \
  --algorithm round_robin \
  --health-check protocol:http,path:/,check_interval_seconds:10 \
  --forwarding-rules entry_protocol:https,entry_port:443,target_protocol:http,target_port:80

# Add multiple droplets
doctl compute load-balancer add-droplets bc-radio-lb \
  --droplet-ids droplet-id-1,droplet-id-2
```

## 🎯 Best Practices

### Development Workflow

1. **Test Locally**: Always test changes locally first
2. **Staging Environment**: Create separate staging droplet
3. **Automated Deployment**: Use CI/CD for updates
4. **Monitoring**: Set up alerts for critical metrics

### Security Maintenance

```bash
# Regular security updates
ssh root@your-droplet-ip
apt update && apt upgrade -y
docker-compose pull
docker-compose up -d
```

### Performance Monitoring

```bash
# Weekly performance review
python3 do-manage.py status
doctl monitoring metrics droplet cpu_utilization --start 2023-01-01T00:00:00Z --end 2023-01-07T23:59:59Z
```

## 🆘 Support and Resources

### DigitalOcean Resources
- [DigitalOcean Documentation](https://docs.digitalocean.com/)
- [Community Tutorials](https://www.digitalocean.com/community/tutorials)
- [API Documentation](https://docs.digitalocean.com/reference/api/)

### BC Radio Resources
- Run `python3 do-manage.py status` for health check
- Check `AZURACAST_CONFIGURATION.md` for AzuraCast setup
- Review `POTENTIAL_ISSUES_AND_FIXES.md` for troubleshooting

### Getting Help

```bash
# Generate diagnostic report
python3 do-manage.py status > diagnostic-report.txt
python3 troubleshoot.py >> diagnostic-report.txt

# Include this report when seeking help
```

---

## 🎵 Conclusion

The DigitalOcean deployment provides a production-ready, scalable solution for BC Radio with:

- ✅ **One-command deployment**
- ✅ **Automatic SSL and security**
- ✅ **Built-in monitoring and backups**
- ✅ **Easy scaling and management**
- ✅ **Cost-effective hosting**

Your BC Radio livestream will be running professionally on DigitalOcean infrastructure with minimal maintenance required!

**🎵 Enjoy streaming Bernie Chiaravalle's music to the world! 🎵**