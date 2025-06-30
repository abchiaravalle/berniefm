# BC Radio - Livestream Setup

A complete livestream radio solution for Bernie Chiaravalle's music collection using AzuraCast, with support for both local development and production deployment with Caddy reverse proxy.

## 🎵 What's Included

- **AzuraCast Docker Setup**: Professional radio streaming server
- **Music Download Script**: Automatically downloads all MP3s from S3 bucket
- **Livestream Interface**: Beautiful web player maintaining original design
- **Build System**: Static site generation for CDN deployment
- **Caddy Integration**: Automatic HTTPS and reverse proxy setup
- **Comprehensive Tools**: Setup validation, troubleshooting, and backup utilities

## 🚀 Quick Start Options

### Option 1: Local Development Setup

Perfect for testing and development:

```bash
# 1. Validate environment
python3 check_setup.py

# 2. Run automated setup
./setup.sh

# 3. Configure AzuraCast (follow prompts)
# Open http://localhost and complete setup wizard
```

### Option 2: DigitalOcean Deployment (Recommended)

Fully automated deployment on DigitalOcean with one command:

```bash
# Complete DigitalOcean setup (creates droplet, firewall, DNS, everything!)
./setup-digitalocean.sh

# Your radio will be live at https://yourdomain.com
```

### Option 3: Production with Caddy (Manual Server)

For production deployment on your own server with automatic HTTPS:

```bash
# 1. Setup AzuraCast backend
./setup.sh

# 2. Install and configure Caddy
./setup-caddy.sh

# 3. Build and deploy static frontend
python3 build.py --init
# Edit build.config.json with your domain
python3 build.py

# 4. Your radio is live at https://yourdomain.com
```

### Option 4: Static Deployment Only

Deploy just the frontend to a CDN/static host:

```bash
# 1. Create build configuration
python3 build.py --init

# 2. Edit build.config.json with your stream server URL

# 3. Build static files
python3 build.py

# 4. Deploy the 'dist' directory to your static hosting
```

## 📋 Detailed Setup Guides

### 🔧 Local Development Setup

1. **Environment Validation**
   ```bash
   python3 check_setup.py
   ```
   This checks Docker, ports, disk space, and internet connectivity.

2. **Automated Setup**
   ```bash
   ./setup.sh
   ```
   Downloads music, starts AzuraCast, and provides setup instructions.

3. **AzuraCast Configuration**
   - Open http://localhost
   - Create admin account
   - Follow the detailed guide in `AZURACAST_CONFIGURATION.md`

4. **Test Your Setup**
   ```bash
   python3 troubleshoot.py
   ```

### � DigitalOcean Deployment (Fully Automated)

#### Prerequisites
- DigitalOcean account
- Domain name (can be purchased through DigitalOcean or any registrar)
- DigitalOcean API token ([Get one here](https://cloud.digitalocean.com/account/api/tokens))

#### One-Command Deployment

```bash
# Install doctl (DigitalOcean CLI) if not installed
# macOS: brew install doctl
# Ubuntu: snap install doctl
# Manual: https://docs.digitalocean.com/reference/doctl/how-to/install/

# Run the complete setup
./setup-digitalocean.sh

# Follow the prompts:
# 1. Enter your DigitalOcean API token
# 2. Enter your domain name
# 3. Choose droplet region and size
# 4. Wait for deployment (5-10 minutes)
# 5. Configure DNS as instructed
```

#### What This Creates
- **Droplet**: Ubuntu 22.04 server with Docker, Caddy, AzuraCast
- **Reserved IP**: Static IP address for your domain
- **Firewall**: Configured for web traffic and streaming
- **Project**: Organized DigitalOcean project
- **Backups**: Automatic daily backups enabled
- **SSL**: Automatic HTTPS with Let's Encrypt
- **Monitoring**: DigitalOcean monitoring enabled

#### Management Commands

```bash
# Check deployment status
python3 do-manage.py status

# View logs
python3 do-manage.py logs

# Restart services
python3 do-manage.py restart

# Create backup snapshot
python3 do-manage.py backup

# Scale droplet size
python3 do-manage.py scale s-4vcpu-8gb

# Monitor services
python3 do-manage.py monitor --duration 600

# Update deployment
python3 do-manage.py update

# Destroy everything (careful!)
python3 do-manage.py destroy
```

#### Cost Estimate
- **Basic Setup (s-2vcpu-4gb)**: ~$28/month
  - Droplet: $24/month
  - Reserved IP: $4/month
  - Backups: 20% of droplet cost
- **Performance Setup (s-4vcpu-8gb)**: ~$58/month
- **High-End Setup (s-8vcpu-16gb)**: ~$115/month

#### Architecture Overview
The setup uses a clean subdomain architecture:
- **yourdomain.com**: BC Radio frontend (Caddy serves static files)
- **yourdomain.com/admin**: AzuraCast admin (proxied to port 8080)
- **yourdomain.com/api**: AzuraCast API (proxied to port 8000)
- **stream.yourdomain.com**: Dedicated streaming subdomain (proxied to port 8000)

#### Port Configuration
- **Port 80**: Caddy web server (serves BC Radio frontend)
- **Port 443**: Caddy HTTPS (automatic SSL)
- **Port 8080**: AzuraCast admin interface
- **Port 8000**: AzuraCast streaming
- **Port 22**: SSH access

### 🌐 Production Deployment with Caddy (Manual Server)

#### Prerequisites
- Your own server with Docker and Python 3 installed
- Domain name pointing to your server
- Sudo access for Caddy installation

#### Step-by-Step Production Setup

1. **Initial Setup**
   ```bash
   # Clone and enter the project
   git clone <your-repo>
   cd bc-radio-livestream
   
   # Validate environment
   python3 check_setup.py
   
   # Setup AzuraCast backend
   ./setup.sh
   ```

2. **Configure AzuraCast**
   ```bash
   # Open http://localhost to configure
   # Follow AZURACAST_CONFIGURATION.md for detailed setup
   ```

3. **Install and Configure Caddy**
   ```bash
   # Run Caddy setup (will prompt for domain)
   ./setup-caddy.sh
   
   # This will:
   # - Install Caddy
   # - Configure reverse proxy
   # - Set up automatic HTTPS
   # - Create necessary directories
   ```

4. **Build and Deploy Frontend**
   ```bash
   # Create build configuration
   python3 build.py --init
   
   # Edit build.config.json with your settings:
   {
     "stream_url": "https://yourdomain.com",
     "domain": "yourdomain.com",
     "title": "Your Radio Station Name"
   }
   
   # Build static files
   python3 build.py
   
   # Files are automatically deployed to /var/www/bc-radio
   ```

5. **DNS Configuration**
   Point your domain to your server:
   ```
   A record: yourdomain.com → YOUR_SERVER_IP
   ```

6. **Test Production Setup**
   ```bash
   # Test HTTPS
   curl -I https://yourdomain.com
   
   # Test stream
   curl -I https://yourdomain.com/stream/listen
   
   # Test API
   curl https://yourdomain.com/api/nowplaying
   ```

### 📦 Static Deployment (CDN/Static Hosting)

Perfect for deploying the frontend to Netlify, Vercel, or any static host while keeping AzuraCast on a separate server.

1. **Create Build Configuration**
   ```bash
   python3 build.py --init
   ```

2. **Configure for Your Stream Server**
   Edit `build.config.json`:
   ```json
   {
     "stream_url": "https://your-frontend-domain.com",
     "stream_domain": "stream.your-stream-server.com",
     "api_endpoint": "/api/nowplaying",
     "stream_endpoint": "/listen",
     "title": "BC Radio - Live Stream",
     "domain": "your-frontend-domain.com",
     "enable_analytics": true,
     "analytics_id": "G-XXXXXXXXXX"
   }
   ```

3. **Build Static Files**
   ```bash
   python3 build.py --clean
   ```

4. **Deploy to Static Host**
   ```bash
   # For Netlify
   netlify deploy --prod --dir=dist
   
   # For Vercel
   vercel --prod dist
   
   # For manual upload
   # Upload everything in the 'dist' directory
   ```

## ⚙️ Configuration Options

### Build Configuration (`build.config.json`)

```json
{
  "stream_url": "https://yourdomain.com",
  "stream_domain": "stream.yourdomain.com",
  "api_endpoint": "/api/nowplaying",
  "stream_endpoint": "/listen",
  "title": "BC Radio - Live Stream",
  "description": "Bernie Chiaravalle Live Stream",
  "domain": "yourdomain.com",
  "enable_pwa": true,
  "enable_analytics": false,
  "analytics_id": "",
  "social_links": {
    "apple_music": "https://music.apple.com/us/artist/bernie-chiaravalle/80848772",
    "spotify": "https://open.spotify.com/artist/4xt2hzGfXdXqKR2msI2gOj",
    "facebook": "https://www.facebook.com/berniechiaravalle/",
    "instagram": "https://www.instagram.com/bvchiaravalle/",
    "website": "https://www.berniechiaravalle.com/"
  }
}
```

### Caddy Configuration

The `Caddyfile` includes:
- Automatic HTTPS with Let's Encrypt
- Reverse proxy to AzuraCast
- CORS headers for API access
- Security headers
- Gzip compression
- Request logging

### AzuraCast Configuration

For detailed AzuraCast setup, see `AZURACAST_CONFIGURATION.md`. Key points:

1. **Create Station**: "BC Radio"
2. **Mount Point**: `/listen` (mapped to `/stream/listen` by Caddy)
3. **Import Music**: Automatic scan of downloaded MP3s
4. **Create Playlists**: Main playlist with all tracks
5. **Enable AutoDJ**: For continuous playback

## 🛠️ Available Tools and Scripts

### Core Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `setup.sh` | Complete local setup | `./setup.sh` |
| `setup-digitalocean.sh` | **Automated DigitalOcean deployment** | `./setup-digitalocean.sh` |
| `setup-caddy.sh` | Production Caddy setup | `./setup-caddy.sh` |
| `build.py` | Build static frontend | `python3 build.py` |
| `download_music.py` | Download music from S3 | `python3 download_music.py` |

### Utility Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `check_setup.py` | Environment validation | `python3 check_setup.py` |
| `troubleshoot.py` | Diagnose and fix issues | `python3 troubleshoot.py` |
| `backup_config.py` | Backup/restore configuration | `python3 backup_config.py create` |
| `do-manage.py` | **DigitalOcean management** | `python3 do-manage.py status` |
| `configure-dns.py` | **Generate DNS instructions** | `python3 configure-dns.py domain.com 1.2.3.4` |

### Build System Commands

```bash
# Initialize build configuration
python3 build.py --init

# Build with custom config
python3 build.py --config my-config.json

# Clean build (remove dist directory first)
python3 build.py --clean

# Build to custom output directory
python3 build.py --output my-dist
```

## 🔍 Troubleshooting

### Common Issues and Solutions

#### 1. Stream Not Playing
```bash
# Check AzuraCast status
python3 troubleshoot.py

# Check Docker containers
docker-compose ps

# Check logs
docker-compose logs azuracast
```

#### 2. Build Errors
```bash
# Validate environment
python3 check_setup.py

# Check if template exists
ls -la index-livestream.html

# Verify configuration
python3 build.py --init
```

#### 3. Caddy Issues
```bash
# Check Caddy status
sudo systemctl status caddy

# Validate Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile

# View logs
sudo journalctl -u caddy -f

# Check if port 80 is available
sudo netstat -tulpn | grep :80
```

#### 4. Port Conflicts
```bash
# Check what's running on each port
sudo netstat -tulpn | grep -E ":(80|443|8080|8000)"

# If AzuraCast is on wrong port, update docker-compose.yml
sed -i 's/"80:80"/"8080:80"/' docker-compose.yml
docker-compose up -d

# Restart Caddy after port changes
sudo systemctl restart caddy
```

#### 5. DNS/SSL Issues
```bash
# Test DNS resolution
nslookup yourdomain.com

# Test HTTPS
curl -I https://yourdomain.com

# Check certificate
openssl s_client -connect yourdomain.com:443
```

### DNS Configuration Help

Need DNS instructions for your domain provider?

```bash
# Generate DNS instructions for any domain/IP
python3 configure-dns.py radio.example.com 1.2.3.4

# Save instructions to file for sharing
python3 configure-dns.py radio.example.com 1.2.3.4 --save dns-instructions.txt
```

This tool provides:
- ✅ **Provider-specific instructions** (Cloudflare, Namecheap, GoDaddy, etc.)
- ✅ **Copy-paste ready DNS records**
- ✅ **Propagation timelines** by provider
- ✅ **Testing commands** to verify setup

### Getting Help

1. **Run diagnostics**: `python3 troubleshoot.py`
2. **Check documentation**: See `POTENTIAL_ISSUES_AND_FIXES.md`
3. **Validate setup**: `python3 check_setup.py`
4. **Generate DNS instructions**: `python3 configure-dns.py yourdomain.com server-ip`
5. **Review logs**: Check Docker and Caddy logs

## 📱 Features and Compatibility

### Visual Features Maintained
- ✅ **Album Artwork**: Dynamic updates based on current track
- ✅ **Unreleased Tags**: Shows "UNRELEASED" for tracks from Random mp3s
- ✅ **3D CD Case Effect**: Maintains skeuomorphic album art display
- ✅ **Time Display**: Current time in bottom-left corner
- ✅ **Weather Widget**: Live weather in top-right corner
- ✅ **Social Media Links**: All original social links preserved
- ✅ **Animations**: GSAP animations and Lottie visualizer
- ✅ **Responsive Design**: Mobile-friendly layout

### Browser Compatibility
- ✅ **Chrome/Chromium**: Full support
- ✅ **Firefox**: Full support
- ✅ **Safari**: Full support (with PWA limitations)
- ✅ **Edge**: Full support
- ✅ **Mobile browsers**: Responsive design

### PWA Features
- ✅ **Add to Home Screen**: iOS and Android support
- ✅ **Offline Capability**: Service worker for caching
- ✅ **Background Playback**: When installed as PWA
- ✅ **App-like Experience**: Full-screen mode

## 🚀 Deployment Architectures

### Architecture 1: All-in-One Server
```
[Domain] → [Caddy] → [AzuraCast + Web UI]
                 ↓
              [Static Files]
```
**Best for**: Small to medium deployments, simple management

### Architecture 2: Separated Frontend
```
[CDN/Static Host] → [Web UI]
                      ↓ API calls
[Stream Server] → [AzuraCast] → [Stream]
```
**Best for**: High traffic, global CDN distribution

### Architecture 3: Load Balanced
```
[Load Balancer] → [Multiple AzuraCast Instances]
       ↓
[Static CDN] → [Web UI]
```
**Best for**: High availability, scaling

## 📊 Monitoring and Analytics

### Built-in Monitoring
- **AzuraCast Analytics**: Built-in listener statistics
- **Caddy Logs**: Request logging and metrics
- **Docker Stats**: Container resource usage

### Optional Integrations
- **Google Analytics**: Enable in build configuration
- **Prometheus**: AzuraCast metrics export
- **Grafana**: Dashboard for monitoring
- **Uptime Monitoring**: External service monitoring

### Health Checks
```bash
# Stream health
curl -I https://stream.yourdomain.com/listen

# API health
curl https://yourdomain.com/api/nowplaying

# Web interface
curl -I https://yourdomain.com
```

## 📚 Documentation

| Document | Description |
|----------|-------------|
| `README.md` | This comprehensive setup guide |
| `DIGITALOCEAN_DEPLOYMENT.md` | **Complete DigitalOcean deployment guide** |
| `AZURACAST_CONFIGURATION.md` | Detailed AzuraCast configuration |
| `POTENTIAL_ISSUES_AND_FIXES.md` | Troubleshooting and known issues |
| `Caddyfile` | Caddy reverse proxy configuration |
| `build.config.json` | Build system configuration (after init) |
| `do-config.json` | DigitalOcean deployment configuration (after setup) |

## 🔧 Advanced Configuration

### Environment Variables

Set these in your shell or `.env` file:

```bash
# For build system
export BC_RADIO_DOMAIN="yourdomain.com"
export BC_RADIO_STREAM_URL="https://yourdomain.com"

# For Docker
export AZURACAST_VERSION="latest"
export COMPOSE_PROJECT_NAME="bc-radio"
```

### Custom Styling

To customize the appearance:

1. **Edit CSS**: Modify styles in `index-livestream.html`
2. **Rebuild**: Run `python3 build.py` to apply changes
3. **Deploy**: Copy `dist/` to your web server

### API Integration

The player uses these API endpoints:

```javascript
// Get current track info
GET /api/nowplaying

// Example response
{
  "station": {
    "now_playing": {
      "song": {
        "title": "Song Title",
        "artist": "Bernie Chiaravalle",
        "album": "Album Name",
        "art": "https://example.com/art.jpg"
      }
    }
  }
}
```

## 🚀 Performance Tips

### For High Traffic
- Use CDN for static assets
- Enable caching headers
- Scale AzuraCast horizontally
- Use load balancer

### For Low Resources
- Reduce stream bitrate
- Limit concurrent listeners
- Use smaller Docker resource limits
- Disable unnecessary features

## 🔐 Security Considerations

### Production Checklist
- [ ] Enable HTTPS (automatic with Caddy)
- [ ] Configure firewall rules
- [ ] Regular security updates
- [ ] Strong admin passwords
- [ ] API access controls
- [ ] Regular backups

### Recommended Firewall Rules
```bash
# Allow HTTP/HTTPS
ufw allow 80
ufw allow 443

# Allow stream ports
ufw allow 8000:8999/tcp

# SSH (adjust port as needed)
ufw allow 22

# Enable firewall
ufw enable
```

## 📈 Scaling and Performance

### Horizontal Scaling
```yaml
# docker-compose.yml for multiple instances
services:
  azuracast-1:
    # ... configuration
  azuracast-2:
    # ... configuration
  
  loadbalancer:
    image: nginx
    # ... load balancer config
```

### Monitoring Setup
```bash
# Install monitoring tools
docker run -d --name prometheus prom/prometheus
docker run -d --name grafana grafana/grafana

# Configure AzuraCast metrics export
# See AzuraCast documentation for details
```

## 🎯 Quick Reference

### Essential Commands
```bash
# Setup and start everything
./setup.sh

# Production deployment
./setup-caddy.sh

# Build static frontend
python3 build.py

# Troubleshoot issues
python3 troubleshoot.py

# Create backup
python3 backup_config.py create

# Check system health
python3 check_setup.py
```

### Important URLs
- **Local Development**: http://localhost
- **Production**: https://yourdomain.com
- **Admin Interface**: https://yourdomain.com/admin
- **Stream URL**: https://stream.yourdomain.com/listen
- **API**: https://yourdomain.com/api/nowplaying

### Support Resources
- **AzuraCast Docs**: https://docs.azuracast.com/
- **Caddy Docs**: https://caddyserver.com/docs/
- **Docker Docs**: https://docs.docker.com/
- **Troubleshooting**: `python3 troubleshoot.py`

---

## 🎉 You're All Set!

Your BC Radio livestream setup is now complete with:
- ✅ Professional streaming backend (AzuraCast)
- ✅ Beautiful web interface maintaining original design
- ✅ Production-ready deployment with automatic HTTPS
- ✅ Static deployment options for CDN hosting
- ✅ Comprehensive monitoring and troubleshooting tools
- ✅ Full mobile and PWA support

**🎵 Enjoy streaming Bernie Chiaravalle's music to the world! 🎵**