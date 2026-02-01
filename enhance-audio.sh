#!/bin/bash

# BC Radio Audio Enhancement Script
# Improves audio quality and processing for professional broadcasting

set -e

echo "🎵 BC Radio Audio Enhancement"
echo "============================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if AzuraCast is running
check_azuracast() {
    if ! docker-compose ps | grep -q "azuracast.*Up"; then
        print_error "AzuraCast is not running. Please start it first."
        exit 1
    fi
    print_success "AzuraCast is running"
}

# Install audio processing tools
install_audio_tools() {
    print_status "Installing audio processing tools..."
    
    # Update package list
    apt update
    
    # Install audio processing packages
    apt install -y \
        liquidsoap-plugin-ladspa \
        ladspa-sdk \
        sox \
        libsox-fmt-all \
        ffmpeg \
        mp3gain \
        normalize-audio
    
    print_success "Audio tools installed"
}

# Configure audio normalization
setup_audio_normalization() {
    print_status "Setting up audio normalization..."
    
    # Create normalization script
    cat > normalize_music.sh << 'EOF'
#!/bin/bash
# Normalize all music files to consistent volume

MUSIC_DIR="./music"
BACKUP_DIR="./music_backup"

echo "Creating backup of original files..."
cp -r "$MUSIC_DIR" "$BACKUP_DIR"

echo "Normalizing audio files..."
find "$MUSIC_DIR" -name "*.mp3" -exec mp3gain -r -k {} \;

echo "Audio normalization complete!"
EOF
    
    chmod +x normalize_music.sh
    print_success "Audio normalization script created"
}

# Configure Liquidsoap for better audio processing
configure_liquidsoap() {
    print_status "Configuring Liquidsoap for professional audio..."
    
    # Create enhanced Liquidsoap configuration
    cat > liquidsoap_enhancements.liq << 'EOF'
# BC Radio Enhanced Audio Configuration

# Audio processing settings
set("audio.samplerate", 44100)
set("audio.channels", 2)

# Crossfade settings
crossfade_duration = 4.0  # 4 second crossfade

# Audio processing chain
def audio_process(s) =
  # Normalize volume
  s = normalize(s, gain_max=3.0, gain_min=-3.0)
  
  # Light compression for broadcast consistency
  s = compress(s, attack=0.1, release=0.5, threshold=-12.0, ratio=3.0)
  
  # EQ for radio sound
  s = filter.iir.eq.high(frequency=80.0, s)    # High-pass filter
  s = filter.iir.eq.peak(frequency=3000.0, gain=1.5, s)  # Presence boost
  
  # Limiter to prevent clipping
  s = limit(s, threshold=-1.0)
  
  s
end

# Enhanced crossfade function
def smart_crossfade(~start_next=5., ~fade_in=3., ~fade_out=3., a, b) =
  add(normalize=false,
      [fade.out(type="sin", duration=fade_out, a),
       fade.in(type="sin", duration=fade_in, b)])
end
EOF
    
    print_success "Enhanced Liquidsoap configuration created"
}

# Setup stream quality monitoring
setup_stream_monitoring() {
    print_status "Setting up stream quality monitoring..."
    
    # Create stream monitor script
    cat > monitor_stream.py << 'EOF'
#!/usr/bin/env python3
"""
BC Radio Stream Quality Monitor
Monitors stream health and audio quality.
"""

import requests
import time
import json
import subprocess
from datetime import datetime

def check_stream_health(stream_url):
    """Check if stream is accessible and responding"""
    try:
        response = requests.head(stream_url, timeout=10)
        return response.status_code == 200
    except:
        return False

def check_audio_quality(stream_url):
    """Check audio quality metrics"""
    try:
        # Use ffprobe to analyze stream
        cmd = [
            'ffprobe', '-v', 'quiet', '-print_format', 'json',
            '-show_streams', stream_url
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode == 0:
            data = json.loads(result.stdout)
            for stream in data.get('streams', []):
                if stream.get('codec_type') == 'audio':
                    return {
                        'bitrate': stream.get('bit_rate', 'unknown'),
                        'sample_rate': stream.get('sample_rate', 'unknown'),
                        'channels': stream.get('channels', 'unknown')
                    }
    except:
        pass
    return None

def monitor_stream():
    """Main monitoring loop"""
    stream_url = "http://localhost:8000/listen"
    
    while True:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # Check stream health
        is_healthy = check_stream_health(stream_url)
        
        # Check audio quality
        quality = check_audio_quality(stream_url)
        
        # Log results
        status = "UP" if is_healthy else "DOWN"
        print(f"[{timestamp}] Stream: {status}")
        
        if quality:
            print(f"  Bitrate: {quality['bitrate']}")
            print(f"  Sample Rate: {quality['sample_rate']}")
            print(f"  Channels: {quality['channels']}")
        
        time.sleep(60)  # Check every minute

if __name__ == "__main__":
    monitor_stream()
EOF
    
    chmod +x monitor_stream.py
    print_success "Stream monitoring script created"
}

# Create audio quality report
create_audio_report() {
    print_status "Creating audio quality report..."
    
    cat > audio_report.py << 'EOF'
#!/usr/bin/env python3
"""
BC Radio Audio Quality Report
Analyzes music library for quality issues.
"""

import os
import subprocess
import json
from pathlib import Path

def analyze_audio_file(file_path):
    """Analyze a single audio file"""
    try:
        cmd = [
            'ffprobe', '-v', 'quiet', '-print_format', 'json',
            '-show_streams', '-show_format', str(file_path)
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode == 0:
            data = json.loads(result.stdout)
            
            # Extract audio stream info
            for stream in data.get('streams', []):
                if stream.get('codec_type') == 'audio':
                    return {
                        'file': str(file_path),
                        'bitrate': int(stream.get('bit_rate', 0)) // 1000,
                        'sample_rate': int(stream.get('sample_rate', 0)),
                        'channels': int(stream.get('channels', 0)),
                        'duration': float(data.get('format', {}).get('duration', 0))
                    }
    except:
        pass
    return None

def generate_report():
    """Generate comprehensive audio quality report"""
    music_dir = Path('./music')
    
    if not music_dir.exists():
        print("❌ Music directory not found")
        return
    
    print("🎵 BC Radio Audio Quality Report")
    print("=" * 50)
    print()
    
    files_analyzed = 0
    quality_issues = []
    bitrate_distribution = {}
    
    # Analyze all MP3 files
    for mp3_file in music_dir.rglob('*.mp3'):
        info = analyze_audio_file(mp3_file)
        if info:
            files_analyzed += 1
            
            # Track bitrate distribution
            bitrate = info['bitrate']
            bitrate_distribution[bitrate] = bitrate_distribution.get(bitrate, 0) + 1
            
            # Check for quality issues
            if bitrate < 128:
                quality_issues.append(f"Low bitrate ({bitrate}k): {info['file']}")
            if info['sample_rate'] not in [44100, 48000]:
                quality_issues.append(f"Non-standard sample rate ({info['sample_rate']}): {info['file']}")
            if info['channels'] != 2:
                quality_issues.append(f"Not stereo ({info['channels']} channels): {info['file']}")
    
    # Print report
    print(f"📊 Files Analyzed: {files_analyzed}")
    print()
    
    print("📈 Bitrate Distribution:")
    for bitrate in sorted(bitrate_distribution.keys()):
        count = bitrate_distribution[bitrate]
        percentage = (count / files_analyzed) * 100
        print(f"  {bitrate}k: {count} files ({percentage:.1f}%)")
    print()
    
    if quality_issues:
        print("⚠️  Quality Issues Found:")
        for issue in quality_issues[:10]:  # Show first 10 issues
            print(f"  • {issue}")
        if len(quality_issues) > 10:
            print(f"  ... and {len(quality_issues) - 10} more issues")
    else:
        print("✅ No quality issues found!")
    
    print()
    print("💡 Recommendations:")
    print("• Target bitrate: 192k or higher for best quality")
    print("• Sample rate: 44.1kHz for music")
    print("• Channels: Stereo (2 channels)")
    print("• Use normalize_music.sh to fix volume inconsistencies")

if __name__ == "__main__":
    generate_report()
EOF
    
    chmod +x audio_report.py
    print_success "Audio quality report script created"
}

# Setup backup strategy
setup_backup_strategy() {
    print_status "Setting up backup strategy..."
    
    cat > backup_station.sh << 'EOF'
#!/bin/bash
# BC Radio Backup Script

BACKUP_DIR="./backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "🔄 Creating BC Radio backup..."

# Backup AzuraCast configuration
docker-compose exec azuracast azuracast_cli backup --path=/tmp/backup.zip
docker cp $(docker-compose ps -q azuracast):/tmp/backup.zip "$BACKUP_DIR/azuracast_backup.zip"

# Backup music library (structure only, not files)
find ./music -name "*.mp3" > "$BACKUP_DIR/music_inventory.txt"

# Backup custom configurations
cp -r ./Caddyfile "$BACKUP_DIR/" 2>/dev/null || true
cp -r ./build.config.json "$BACKUP_DIR/" 2>/dev/null || true
cp -r ./do-config.json "$BACKUP_DIR/" 2>/dev/null || true

echo "✅ Backup created: $BACKUP_DIR"
EOF
    
    chmod +x backup_station.sh
    print_success "Backup strategy configured"
}

# Main execution
main() {
    print_status "Starting BC Radio audio enhancement..."
    
    # Check if running as root
    if [[ $EUID -ne 0 ]]; then
        print_error "This script must be run as root for package installation"
        exit 1
    fi
    
    # Check prerequisites
    check_azuracast
    
    # Install audio processing tools
    install_audio_tools
    
    # Setup audio enhancements
    setup_audio_normalization
    configure_liquidsoap
    setup_stream_monitoring
    create_audio_report
    setup_backup_strategy
    
    echo ""
    echo "🎉 Audio Enhancement Complete!"
    echo "=============================="
    echo ""
    echo "Available tools:"
    echo "• ./normalize_music.sh - Normalize audio levels"
    echo "• python3 audio_report.py - Analyze audio quality"
    echo "• python3 monitor_stream.py - Monitor stream health"
    echo "• ./backup_station.sh - Create station backup"
    echo ""
    echo "Next steps:"
    echo "1. Run audio quality report: python3 audio_report.py"
    echo "2. Normalize audio if needed: ./normalize_music.sh"
    echo "3. Apply Liquidsoap enhancements in AzuraCast admin"
    echo "4. Start stream monitoring: python3 monitor_stream.py &"
    echo ""
    echo "🎵 Your BC Radio now has professional audio processing!"
}

# Run main function
main "$@"