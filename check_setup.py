#!/usr/bin/env python3
"""
BC Radio Setup Checker
Validates the environment and identifies potential issues before running the livestream setup.
"""

import subprocess
import sys
import os
from pathlib import Path
import urllib.request
import json

def check_command(command, name):
    """Check if a command is available"""
    try:
        result = subprocess.run([command, '--version'], 
                              capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            version = result.stdout.strip().split('\n')[0]
            print(f"✅ {name}: {version}")
            return True
    except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.SubprocessError):
        pass
    
    print(f"❌ {name}: Not found or not working")
    return False

def check_docker():
    """Check Docker and Docker Compose"""
    docker_ok = check_command('docker', 'Docker')
    compose_ok = check_command('docker-compose', 'Docker Compose')
    
    if docker_ok:
        try:
            # Check if Docker daemon is running
            result = subprocess.run(['docker', 'info'], 
                                  capture_output=True, text=True, timeout=10)
            if result.returncode != 0:
                print("⚠️  Docker daemon is not running")
                return False
        except subprocess.TimeoutExpired:
            print("⚠️  Docker daemon is not responding")
            return False
    
    return docker_ok and compose_ok

def check_files():
    """Check required files exist"""
    required_files = [
        'index.html',
        'docker-compose.yml',
        'download_music.py',
        'index-livestream.html',
        'setup.sh'
    ]
    
    all_good = True
    for file in required_files:
        if Path(file).exists():
            print(f"✅ {file}: Found")
        else:
            print(f"❌ {file}: Missing")
            all_good = False
    
    return all_good

def check_ports():
    """Check if required ports are available"""
    import socket
    
    ports_to_check = [80, 443, 8000]
    all_good = True
    
    for port in ports_to_check:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        result = sock.connect_ex(('localhost', port))
        sock.close()
        
        if result == 0:
            print(f"⚠️  Port {port}: In use (may cause conflicts)")
            all_good = False
        else:
            print(f"✅ Port {port}: Available")
    
    return all_good

def check_disk_space():
    """Check available disk space"""
    try:
        statvfs = os.statvfs('.')
        free_bytes = statvfs.f_frsize * statvfs.f_bavail
        free_gb = free_bytes / (1024**3)
        
        if free_gb < 5:
            print(f"⚠️  Disk space: {free_gb:.1f} GB (may not be enough for music + Docker)")
            return False
        else:
            print(f"✅ Disk space: {free_gb:.1f} GB available")
            return True
    except Exception as e:
        print(f"⚠️  Could not check disk space: {e}")
        return True

def check_internet():
    """Check internet connectivity"""
    test_urls = [
        'https://web-assets-acwebdev.s3.amazonaws.com/',
        'https://ghcr.io',
        'https://ipapi.co/json',
        'https://api.open-meteo.com'
    ]
    
    all_good = True
    for url in test_urls:
        try:
            urllib.request.urlopen(url, timeout=5)
            print(f"✅ {url}: Accessible")
        except Exception as e:
            print(f"❌ {url}: Not accessible ({e})")
            all_good = False
    
    return all_good

def check_mp3_availability():
    """Check if MP3 files are accessible"""
    test_url = "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Chiaro%20Destino%20mp3%20version/01%20Things%20We%20Said%20Today.mp3"
    
    try:
        req = urllib.request.Request(test_url, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; BC Radio Setup Checker)'
        })
        response = urllib.request.urlopen(req, timeout=10)
        
        if response.status == 200:
            size = response.headers.get('Content-Length', 'Unknown')
            print(f"✅ Sample MP3: Accessible (size: {size} bytes)")
            return True
        else:
            print(f"⚠️  Sample MP3: HTTP {response.status}")
            return False
            
    except Exception as e:
        print(f"❌ Sample MP3: Not accessible ({e})")
        return False

def check_system_resources():
    """Check system resources"""
    try:
        import psutil
        
        # Check RAM
        memory = psutil.virtual_memory()
        ram_gb = memory.total / (1024**3)
        
        if ram_gb < 2:
            print(f"⚠️  RAM: {ram_gb:.1f} GB (AzuraCast may struggle)")
        else:
            print(f"✅ RAM: {ram_gb:.1f} GB")
        
        # Check CPU
        cpu_count = psutil.cpu_count()
        print(f"✅ CPU cores: {cpu_count}")
        
        return ram_gb >= 1  # Minimum 1GB
        
    except ImportError:
        print("ℹ️  Install 'psutil' for detailed system resource checking")
        return True
    except Exception as e:
        print(f"⚠️  Could not check system resources: {e}")
        return True

def main():
    """Main setup checker"""
    print("🔍 BC Radio Setup Checker")
    print("=" * 50)
    
    checks = [
        ("Docker & Docker Compose", check_docker),
        ("Required Files", check_files),
        ("Port Availability", check_ports),
        ("Disk Space", check_disk_space),
        ("Internet Connectivity", check_internet),
        ("MP3 File Access", check_mp3_availability),
        ("System Resources", check_system_resources)
    ]
    
    results = []
    
    for check_name, check_func in checks:
        print(f"\n📋 Checking {check_name}:")
        try:
            result = check_func()
            results.append((check_name, result))
        except Exception as e:
            print(f"❌ Error during {check_name} check: {e}")
            results.append((check_name, False))
    
    # Summary
    print(f"\n📊 Summary:")
    print("=" * 50)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for check_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} {check_name}")
    
    print(f"\nOverall: {passed}/{total} checks passed")
    
    if passed == total:
        print("\n🎉 All checks passed! You're ready to run ./setup.sh")
    else:
        print("\n⚠️  Some checks failed. Please address the issues above before proceeding.")
        
        # Provide specific recommendations
        print("\n💡 Recommendations:")
        
        for check_name, result in results:
            if not result:
                if "Docker" in check_name:
                    print("   • Install Docker and Docker Compose")
                    print("   • Start the Docker daemon")
                elif "Files" in check_name:
                    print("   • Make sure you're in the correct directory")
                    print("   • Check that all files were created properly")
                elif "Port" in check_name:
                    print("   • Stop services using ports 80, 443, or 8000")
                    print("   • Or modify docker-compose.yml to use different ports")
                elif "Disk" in check_name:
                    print("   • Free up disk space (music library ~2-3GB + Docker images)")
                elif "Internet" in check_name:
                    print("   • Check your internet connection")
                    print("   • Verify firewall/proxy settings")
                elif "MP3" in check_name:
                    print("   • Check if S3 bucket is accessible")
                    print("   • Verify no network restrictions")

if __name__ == "__main__":
    main()