# 🚀 BC Radio Production Setup - Quick Start Guide

## One-Command Complete Setup

Yes! There's now a **master setup script** that configures everything automatically.

### 🎯 **Super Simple Setup**

```bash
# For DigitalOcean cloud deployment (Recommended)
sudo ./setup-production.sh --domain bcradio.com --email admin@bcradio.com --type digitalocean

# For local development/testing
sudo ./setup-production.sh --type local --skip-prompts

# See what would be done (dry run)
sudo ./setup-production.sh --domain bcradio.com --type digitalocean --dry-run
```

## 📋 **What Gets Configured Automatically**

### ✅ **Infrastructure**
- DigitalOcean droplet creation (if selected)
- Docker and Docker Compose installation
- AzuraCast radio streaming platform
- Caddy reverse proxy with automatic SSL
- Firewall and security configuration

### ✅ **Audio Processing**
- Professional audio normalization
- Crossfading between tracks
- Dynamic range compression
- EQ processing for radio sound
- Stream quality monitoring

### ✅ **Legal Compliance**
- Privacy policy generation
- Terms of service creation
- DMCA compliance framework
- Broadcast logging system
- Music licensing guidance

### ✅ **Monitoring & Analytics**
- Prometheus metrics collection
- Grafana dashboards
- Real-time alerting system
- System health monitoring
- Stream quality tracking

### ✅ **Web Interface**
- BC Radio livestream frontend
- Pixel-perfect visual design
- Mobile-responsive interface
- PWA functionality
- Social media integration

### ✅ **Backup & Recovery**
- Automated daily backups
- Configuration backup
- Database backup system
- Recovery procedures

## 🎵 **Usage Examples**

### **Full Production Deployment**
```bash
sudo ./setup-production.sh \
  --domain myradio.com \
  --email admin@myradio.com \
  --type digitalocean
```

### **Local Development**
```bash
sudo ./setup-production.sh --type local --skip-prompts
```

### **Custom Server**
```bash
sudo ./setup-production.sh \
  --domain myradio.com \
  --email admin@myradio.com \
  --type custom
```

### **Interactive Setup**
```bash
sudo ./setup-production.sh
# Script will ask for domain, email, and setup type
```

## 📊 **After Setup Complete**

### **Access Your Station**
- **Radio Station**: https://yourdomain.com
- **Admin Panel**: https://yourdomain.com/admin
- **Stream URL**: https://stream.yourdomain.com/listen
- **Monitoring**: http://localhost:3000 (admin/bcradio123)

### **Management Commands**
```bash
# Check status
docker-compose ps

# View logs
docker-compose logs -f

# Restart services
docker-compose restart

# Create backup
./backup_station.sh

# Check audio quality
python3 audio_report.py

# Monitor stream
python3 monitor_stream.py
```

## ⚠️ **Critical Next Steps**

### **1. Music Licensing (REQUIRED)**
```bash
python3 legal-compliance.py licensing
```
- **ASCAP**: $288-2,500/year
- **BMI**: $288-2,500/year  
- **SESAC**: Contact for pricing
- **SoundExchange**: % of revenue

### **2. Review Legal Documents**
- `privacy_policy.md`
- `terms_of_service.md`
- `dmca_policy.md`

### **3. Configure Monitoring Alerts**
Edit `monitoring/alertmanager/alertmanager.yml` with your email

### **4. Audio Quality Check**
```bash
python3 audio_report.py
./normalize_music.sh  # If needed
```

## 🛠️ **Available Setup Scripts**

### **Individual Components**
```bash
# Audio enhancement only
sudo ./enhance-audio.sh

# Monitoring only  
sudo ./setup-monitoring.sh

# Legal compliance only
python3 legal-compliance.py all yourdomain.com

# DigitalOcean infrastructure only
sudo ./setup-digitalocean.sh

# DNS configuration help
python3 configure-dns.py
```

### **Management Tools**
```bash
# DigitalOcean management
python3 do-manage.py status
python3 do-manage.py logs
python3 do-manage.py restart

# Build system
python3 build.py --domain yourdomain.com

# Troubleshooting
python3 troubleshoot.py
```

## 🎯 **Setup Types Explained**

### **DigitalOcean (Recommended)**
- **Cost**: ~$30-50/month
- **Features**: Full cloud deployment, automatic SSL, monitoring
- **Best for**: Production radio stations
- **Includes**: Droplet, DNS, firewall, backups

### **Local Development**
- **Cost**: Free
- **Features**: Full functionality on localhost
- **Best for**: Testing, development, learning
- **Includes**: Docker setup, monitoring, audio processing

### **Custom Server**
- **Cost**: Your server costs
- **Features**: Deploy on your existing server
- **Best for**: Existing infrastructure
- **Requires**: Manual DNS and SSL setup

## 📈 **Scaling Your Station**

### **Traffic Levels**
- **Hobby**: 1-100 listeners → Current setup perfect
- **Small**: 100-1,000 listeners → Add CDN
- **Medium**: 1,000-10,000 listeners → Load balancing
- **Large**: 10,000+ listeners → Multi-region deployment

### **Upgrade Path**
```bash
# Add CDN (Cloudflare)
# Configure in build.config.json

# Add monitoring alerts
# Configure email in alertmanager.yml

# Scale infrastructure
python3 do-manage.py scale --size s-2vcpu-4gb
```

## 🎵 **Final Result**

After running `setup-production.sh`, you'll have:

✅ **Professional radio station** streaming Bernie Chiaravalle's music  
✅ **Production-ready infrastructure** with monitoring and backups  
✅ **Legal compliance framework** (you still need to apply for licenses)  
✅ **Professional audio processing** with crossfading and normalization  
✅ **Beautiful web interface** matching the original BC Radio design  
✅ **Mobile-friendly streaming** with PWA support  
✅ **Automated management tools** for ongoing operations  

## 🚨 **Important Notes**

1. **Music Licensing is CRITICAL** - Apply before going live
2. **Estimated Total Cost**: $1,500-5,000/year (mostly licensing)
3. **Setup Time**: 15-30 minutes for full deployment
4. **Maintenance**: Mostly automated with monitoring alerts

## 🎯 **Bottom Line**

**One command gets you a complete production radio station:**

```bash
sudo ./setup-production.sh --domain yourdomain.com --email you@email.com --type digitalocean
```

That's it! Your professional BC Radio station will be live and streaming. 🎵