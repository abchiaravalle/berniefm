# Potential Issues and Fixes for BC Radio Livestream

This document outlines potential bugs, edge cases, and additional requirements that may arise during setup and operation.

## 🐛 Identified Potential Bugs and Fixes

### 1. **Download Script Issues**

**Fixed Issues:**
- ✅ **File validation**: Added MP3 header validation to ensure downloaded files are valid
- ✅ **Resume capability**: Script now skips existing valid files and re-downloads invalid ones
- ✅ **Error handling**: Better error messages and timeout handling
- ✅ **Filename sanitization**: Handles special characters in filenames
- ✅ **Failed download tracking**: Saves failed URLs to `failed_downloads.txt` for retry

**Remaining Risks:**
- Large file downloads may timeout on slow connections
- S3 bucket rate limiting could cause failures
- Disk space exhaustion during download

### 2. **Docker Configuration Issues**

**Potential Problems:**
- Port conflicts (80, 443, 8000 already in use)
- Insufficient system resources (< 2GB RAM)
- Docker daemon not running
- Volume permission issues

**Mitigations:**
- ✅ Added port checking in `check_setup.py`
- ✅ Created troubleshooting script to diagnose Docker issues
- ✅ Included system resource checking

### 3. **Stream URL Hardcoding**

**Issue:** `index-livestream.html` hardcodes `localhost` URLs
**Impact:** Won't work when deployed to a domain
**Fix Needed:** Environment-based URL configuration

```javascript
// Current (problematic):
fetch('http://localhost:8000/api/nowplaying')

// Better approach:
const baseUrl = window.location.protocol === 'file:' 
  ? 'http://localhost:8000' 
  : window.location.origin.replace(':80', ':8000');
```

### 4. **CORS Issues**

**Problem:** Browser CORS restrictions when accessing AzuraCast API
**Symptoms:** API calls fail from `file://` protocol or different domains
**Solution:** Configure AzuraCast CORS settings or use a proxy

### 5. **Unreleased Tag Detection**

**Fixed:** Enhanced the detection logic in `index-livestream.html` to check:
- Album name contains "unreleased" or "random"
- File path contains "Random mp3s"
- Multiple fallback methods

### 6. **Mobile/iOS Limitations**

**Known Issues:**
- iOS Safari requires user interaction to start audio
- Background playback limitations on mobile browsers
- PWA installation may not work on all devices

**Mitigations:**
- ✅ Added iOS-specific PWA notifications
- ✅ Included user interaction requirements in interface
- ✅ Documented mobile limitations

## 🔧 Additional Tools Created

### 1. **Setup Checker** (`check_setup.py`)
- Validates environment before installation
- Checks Docker, ports, disk space, internet connectivity
- Tests S3 bucket accessibility

### 2. **Troubleshooting Tool** (`troubleshoot.py`)
- Diagnoses common issues
- Automatic fixes for file permissions
- Container restart capabilities
- Log analysis

### 3. **Backup Tool** (`backup_config.py`)
- Backs up AzuraCast configuration and playlists
- Excludes large music files (structure only)
- Restore functionality for disaster recovery

## 📋 Additional Requirements You May Need

### 1. **Production Deployment**

**SSL Certificate:**
```bash
# Using Let's Encrypt with Certbot
sudo apt install certbot
sudo certbot --nginx -d yourdomain.com
```

**Reverse Proxy Configuration:**
```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;
    
    location / {
        proxy_pass http://localhost:80;
        proxy_set_header Host $host;
    }
    
    location /api/ {
        proxy_pass http://localhost:8000;
        add_header Access-Control-Allow-Origin *;
    }
}
```

### 2. **Performance Optimization**

**For High Traffic:**
- Increase Docker container resources
- Set up CDN for static assets
- Configure multiple stream mount points
- Enable caching

**Docker Resource Limits:**
```yaml
services:
  azuracast:
    deploy:
      resources:
        limits:
          memory: 4G
          cpus: '2.0'
```

### 3. **Monitoring and Alerting**

**Stream Uptime Monitoring:**
```bash
# Simple uptime check script
curl -f http://localhost:8000/listen > /dev/null || echo "Stream down!"
```

**Log Monitoring:**
- Set up log aggregation (ELK stack)
- Configure alerts for stream failures
- Monitor disk space and memory usage

### 4. **Content Management**

**Automated Music Updates:**
- Webhook to trigger re-download when S3 bucket updates
- Automatic playlist regeneration
- Metadata cleanup scripts

### 5. **Analytics and Reporting**

**Listener Statistics:**
- AzuraCast provides built-in analytics
- Export listener data for external analysis
- Track popular songs and peak listening times

## 🚨 Critical Issues to Watch For

### 1. **Stream Interruption**
**Causes:**
- Container restart
- Music file corruption
- Network issues
- Resource exhaustion

**Monitoring:**
```bash
# Check stream health
curl -I http://localhost:8000/listen
```

### 2. **Database Corruption**
**Prevention:**
- Regular backups using `backup_config.py`
- Monitor disk space
- Graceful container shutdowns

### 3. **Music File Issues**
**Problems:**
- Corrupted downloads
- Missing files
- Permission issues

**Detection:**
```bash
# Check for broken files
find music/ -name "*.mp3" -size -1k
```

## 🔍 Testing Checklist

Before going live, test:

- [ ] Stream plays correctly in multiple browsers
- [ ] Mobile compatibility (iOS Safari, Android Chrome)
- [ ] Album art updates properly
- [ ] Unreleased tags appear correctly
- [ ] Volume control works
- [ ] PWA installation functions
- [ ] API endpoints respond correctly
- [ ] Container restart doesn't break stream
- [ ] Backup and restore procedures work
- [ ] All social media links function

## 🛠️ Emergency Procedures

### Stream Down
1. Run `python3 troubleshoot.py`
2. Check `docker-compose logs azuracast`
3. Restart container: `docker-compose restart`
4. Verify mount points in AzuraCast admin

### Complete Failure
1. Restore from backup: `python3 backup_config.py restore <backup_file>`
2. Re-run setup: `./setup.sh`
3. Reconfigure AzuraCast following `AZURACAST_CONFIGURATION.md`

### Music Library Issues
1. Re-run download: `python3 download_music.py`
2. Fix permissions: `chmod -R 755 music/`
3. Trigger media scan in AzuraCast admin

## 📞 Support Resources

- **AzuraCast Documentation**: https://docs.azuracast.com/
- **Docker Documentation**: https://docs.docker.com/
- **Troubleshooting Tool**: `python3 troubleshoot.py`
- **Setup Validation**: `python3 check_setup.py`

## 🎯 Recommended Next Steps

1. **Run setup validation**: `python3 check_setup.py`
2. **Test in development**: Follow README.md setup
3. **Create initial backup**: `python3 backup_config.py create`
4. **Document your specific configuration**
5. **Plan production deployment strategy**
6. **Set up monitoring and alerting**

---

**Remember:** Always test thoroughly in a development environment before deploying to production!