#!/usr/bin/env python3
"""
BC Radio Troubleshooting Tool
Helps diagnose and fix common issues with the livestream setup.
"""

import subprocess
import json
import urllib.request
import time
import sys
from pathlib import Path

def run_command(cmd, description=""):
    """Run a command and return result"""
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
        return result.returncode == 0, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return False, "", f"Command timed out: {cmd}"
    except Exception as e:
        return False, "", str(e)

def check_docker_status():
    """Check Docker container status"""
    print("🐳 Checking Docker Status...")
    
    success, stdout, stderr = run_command("docker-compose ps")
    if not success:
        print("❌ Docker Compose not working")
        return False
    
    if "azuracast" in stdout and "Up" in stdout:
        print("✅ AzuraCast container is running")
        return True
    else:
        print("❌ AzuraCast container is not running")
        print("Attempting to start...")
        
        success, stdout, stderr = run_command("docker-compose up -d")
        if success:
            print("✅ Started AzuraCast container")
            time.sleep(10)  # Wait for startup
            return True
        else:
            print(f"❌ Failed to start: {stderr}")
            return False

def check_azuracast_web():
    """Check if AzuraCast web interface is accessible"""
    print("🌐 Checking AzuraCast Web Interface...")
    
    try:
        response = urllib.request.urlopen("http://localhost", timeout=10)
        if response.status == 200:
            print("✅ AzuraCast web interface is accessible")
            return True
    except Exception as e:
        print(f"❌ AzuraCast web interface not accessible: {e}")
        return False

def check_stream_endpoint():
    """Check if stream endpoint is working"""
    print("📻 Checking Stream Endpoint...")
    
    try:
        response = urllib.request.urlopen("http://localhost:8000/listen", timeout=10)
        if response.status == 200:
            print("✅ Stream endpoint is accessible")
            return True
    except Exception as e:
        print(f"❌ Stream endpoint not accessible: {e}")
        return False

def check_api_endpoint():
    """Check AzuraCast API"""
    print("🔌 Checking AzuraCast API...")
    
    try:
        response = urllib.request.urlopen("http://localhost:8000/api/nowplaying", timeout=10)
        if response.status == 200:
            data = json.loads(response.read())
            if data and len(data) > 0:
                print("✅ API is working and returning data")
                station = data[0]
                if 'now_playing' in station:
                    current = station['now_playing']
                    if current and 'song' in current:
                        song = current['song']
                        title = song.get('title', 'Unknown')
                        artist = song.get('artist', 'Unknown')
                        print(f"   Currently playing: {artist} - {title}")
                return True
            else:
                print("⚠️  API working but no station data")
                return False
    except Exception as e:
        print(f"❌ API not working: {e}")
        return False

def check_music_files():
    """Check if music files are present"""
    print("🎵 Checking Music Files...")
    
    music_dir = Path("music")
    if not music_dir.exists():
        print("❌ Music directory doesn't exist")
        return False
    
    mp3_files = list(music_dir.rglob("*.mp3"))
    if len(mp3_files) == 0:
        print("❌ No MP3 files found")
        return False
    
    print(f"✅ Found {len(mp3_files)} MP3 files")
    
    # Check if files are accessible by AzuraCast
    success, stdout, stderr = run_command("docker exec azuracast ls -la /var/azuracast/www_tmp/music")
    if success and "mp3" in stdout.lower():
        print("✅ Music files accessible by AzuraCast")
        return True
    else:
        print("⚠️  Music files may not be accessible by AzuraCast")
        return False

def fix_permissions():
    """Fix file permissions for music directory"""
    print("🔧 Fixing file permissions...")
    
    success, stdout, stderr = run_command("chmod -R 755 music/")
    if success:
        print("✅ Fixed music directory permissions")
    else:
        print(f"❌ Failed to fix permissions: {stderr}")
    
    return success

def restart_azuracast():
    """Restart AzuraCast container"""
    print("🔄 Restarting AzuraCast...")
    
    # Stop
    success, stdout, stderr = run_command("docker-compose stop")
    if not success:
        print(f"⚠️  Error stopping: {stderr}")
    
    time.sleep(5)
    
    # Start
    success, stdout, stderr = run_command("docker-compose up -d")
    if success:
        print("✅ AzuraCast restarted")
        time.sleep(15)  # Wait for startup
        return True
    else:
        print(f"❌ Failed to restart: {stderr}")
        return False

def check_logs():
    """Check AzuraCast logs for errors"""
    print("📋 Checking AzuraCast Logs...")
    
    success, stdout, stderr = run_command("docker-compose logs --tail=50 azuracast")
    if success:
        # Look for common error patterns
        errors = []
        for line in stdout.split('\n'):
            if any(keyword in line.lower() for keyword in ['error', 'failed', 'exception', 'fatal']):
                errors.append(line)
        
        if errors:
            print(f"⚠️  Found {len(errors)} potential issues in logs:")
            for error in errors[-5:]:  # Show last 5 errors
                print(f"   {error}")
        else:
            print("✅ No obvious errors in recent logs")
        
        return len(errors) == 0
    else:
        print(f"❌ Could not read logs: {stderr}")
        return False

def run_media_scan():
    """Trigger media scan in AzuraCast"""
    print("🔍 Triggering media scan...")
    
    # This would require API access or CLI command
    # For now, just provide instructions
    print("ℹ️  To scan for new media:")
    print("   1. Go to http://localhost")
    print("   2. Navigate to Stations > BC Radio > Media")
    print("   3. Click 'Scan for New Files'")
    
    return True

def main():
    """Main troubleshooting routine"""
    print("🔧 BC Radio Troubleshooting Tool")
    print("=" * 50)
    
    issues_found = []
    fixes_applied = []
    
    # Run diagnostics
    checks = [
        ("Docker Status", check_docker_status),
        ("AzuraCast Web Interface", check_azuracast_web),
        ("Stream Endpoint", check_stream_endpoint),
        ("API Endpoint", check_api_endpoint),
        ("Music Files", check_music_files),
    ]
    
    for check_name, check_func in checks:
        print(f"\n📋 {check_name}:")
        try:
            if not check_func():
                issues_found.append(check_name)
        except Exception as e:
            print(f"❌ Error during {check_name}: {e}")
            issues_found.append(check_name)
    
    # Check logs regardless
    print(f"\n📋 Log Analysis:")
    check_logs()
    
    # Suggest fixes
    if issues_found:
        print(f"\n🔧 Issues Found: {len(issues_found)}")
        print("Attempting automatic fixes...")
        
        if "Music Files" in issues_found:
            if fix_permissions():
                fixes_applied.append("Fixed file permissions")
        
        if any("AzuraCast" in issue or "Stream" in issue or "API" in issue for issue in issues_found):
            print("\nWould you like to restart AzuraCast? (y/N): ", end="")
            try:
                response = input().strip().lower()
                if response == 'y':
                    if restart_azuracast():
                        fixes_applied.append("Restarted AzuraCast")
                        
                        # Re-check critical services
                        print("\n🔄 Re-checking services...")
                        time.sleep(5)
                        check_azuracast_web()
                        check_stream_endpoint()
                        check_api_endpoint()
            except KeyboardInterrupt:
                print("\nSkipping restart...")
    
    # Final summary
    print(f"\n📊 Troubleshooting Summary:")
    print("=" * 50)
    
    if not issues_found:
        print("🎉 No issues found! Everything looks good.")
    else:
        print(f"⚠️  Issues found: {len(issues_found)}")
        for issue in issues_found:
            print(f"   • {issue}")
        
        if fixes_applied:
            print(f"\n✅ Fixes applied: {len(fixes_applied)}")
            for fix in fixes_applied:
                print(f"   • {fix}")
        
        print(f"\n💡 Additional Steps:")
        print("   • Check the full setup guide in README.md")
        print("   • Review AzuraCast configuration in AZURACAST_CONFIGURATION.md")
        print("   • Run 'python3 check_setup.py' for environment validation")
        print("   • Check Docker logs: docker-compose logs azuracast")
        
        if "Music Files" in issues_found:
            print("   • Run 'python3 download_music.py' to download music")
        
        if any("Stream" in issue or "API" in issue for issue in issues_found):
            print("   • Ensure AzuraCast station is configured and broadcasting")
            print("   • Check mount points are set up correctly")

if __name__ == "__main__":
    main()