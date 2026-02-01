#!/usr/bin/env python3
"""
Download all MP3 files from Bernie Chiaravalle's S3 bucket for AzuraCast streaming.
This script extracts MP3 URLs from index.html and downloads them to the music directory.
"""

import os
import re
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path
import time
import sys

def extract_mp3_urls_from_html():
    """Extract all MP3 URLs from index.html"""
    mp3_urls = []
    
    # Check if index.html exists
    if not Path('index.html').exists():
        print("❌ Error: index.html not found in current directory")
        print("   Make sure you're running this script from the project root")
        sys.exit(1)
    
    try:
        with open('index.html', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"❌ Error reading index.html: {e}")
        sys.exit(1)
    
    # Find all lines with .mp3 URLs
    mp3_pattern = r'`\${base}([^`]+\.mp3)`'
    matches = re.findall(mp3_pattern, content)
    
    if not matches:
        print("❌ No MP3 URLs found in index.html")
        print("   Check that index.html contains the expected audioFiles array")
        sys.exit(1)
    
    base_url = "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/"
    
    for match in matches:
        full_url = base_url + match
        mp3_urls.append(full_url)
    
    return mp3_urls

def validate_file(file_path):
    """Validate that downloaded file is a valid MP3"""
    try:
        if file_path.stat().st_size < 1000:  # Less than 1KB is probably not a valid MP3
            return False
        
        # Check for MP3 header (basic validation)
        with open(file_path, 'rb') as f:
            header = f.read(3)
            # MP3 files start with ID3 tag or MP3 frame sync
            if header.startswith(b'ID3') or header.startswith(b'\xff\xfb') or header.startswith(b'\xff\xfa'):
                return True
        return False
    except Exception:
        return False

def download_file(url, local_path):
    """Download a file from URL to local path with validation"""
    try:
        # Create directory if it doesn't exist
        local_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Skip if file already exists and is valid
        if local_path.exists():
            if validate_file(local_path):
                print(f"✓ Already exists: {local_path.name}")
                return True
            else:
                print(f"⚠️  Invalid file found, re-downloading: {local_path.name}")
                local_path.unlink()  # Remove invalid file
        
        print(f"📥 Downloading: {local_path.name}")
        
        # Add User-Agent to avoid potential blocking
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; BC Radio Music Downloader)'
        })
        
        # Download with timeout
        with urllib.request.urlopen(req, timeout=30) as response:
            with open(local_path, 'wb') as f:
                f.write(response.read())
        
        # Validate downloaded file
        if validate_file(local_path):
            print(f"✅ Downloaded: {local_path.name}")
            return True
        else:
            print(f"❌ Downloaded file is invalid: {local_path.name}")
            local_path.unlink()  # Remove invalid file
            return False
        
    except urllib.error.HTTPError as e:
        print(f"❌ HTTP Error {e.code} for {url}")
        return False
    except urllib.error.URLError as e:
        print(f"❌ URL Error for {url}: {e}")
        return False
    except Exception as e:
        print(f"❌ Failed to download {url}: {e}")
        return False

def sanitize_filename(filename):
    """Sanitize filename for filesystem compatibility"""
    # Replace problematic characters
    filename = re.sub(r'[<>:"/\\|?*]', '_', filename)
    # Remove control characters
    filename = ''.join(char for char in filename if ord(char) >= 32)
    # Limit length
    if len(filename) > 200:
        name, ext = os.path.splitext(filename)
        filename = name[:196] + ext
    return filename

def main():
    """Main function to download all MP3 files"""
    print("🎵 Bernie Chiaravalle Music Downloader for AzuraCast")
    print("=" * 60)
    
    # Create music directory
    music_dir = Path("music")
    music_dir.mkdir(exist_ok=True)
    
    # Extract MP3 URLs
    print("📋 Extracting MP3 URLs from index.html...")
    try:
        mp3_urls = extract_mp3_urls_from_html()
    except Exception as e:
        print(f"❌ Failed to extract URLs: {e}")
        sys.exit(1)
    
    print(f"Found {len(mp3_urls)} MP3 files to download")
    
    # Download each file
    downloaded = 0
    failed = 0
    failed_urls = []
    
    for i, url in enumerate(mp3_urls, 1):
        print(f"\n[{i}/{len(mp3_urls)}]", end=" ")
        
        try:
            # Parse URL to create local path
            parsed_url = urllib.parse.urlparse(url)
            # Remove the base path to get relative path
            relative_path = parsed_url.path.replace('/Bernie%20Chiaravalle/', '')
            # Decode URL encoding
            relative_path = urllib.parse.unquote(relative_path)
            # Sanitize filename
            relative_path = sanitize_filename(relative_path)
            
            local_path = music_dir / relative_path
            
            if download_file(url, local_path):
                downloaded += 1
            else:
                failed += 1
                failed_urls.append(url)
                
        except Exception as e:
            print(f"❌ Error processing {url}: {e}")
            failed += 1
            failed_urls.append(url)
            
        # Small delay to be respectful to the server
        time.sleep(0.2)
    
    print(f"\n🎉 Download complete!")
    print(f"✅ Successfully downloaded: {downloaded} files")
    if failed > 0:
        print(f"❌ Failed downloads: {failed} files")
        
        # Save failed URLs for retry
        if failed_urls:
            failed_file = Path("failed_downloads.txt")
            with open(failed_file, 'w') as f:
                for url in failed_urls:
                    f.write(f"{url}\n")
            print(f"📄 Failed URLs saved to: {failed_file}")
            print("   You can retry these manually or run the script again")
    
    print(f"\n📁 All music files are now in the 'music' directory")
    
    # Check total size
    try:
        total_size = sum(f.stat().st_size for f in music_dir.rglob('*.mp3'))
        size_mb = total_size / (1024 * 1024)
        print(f"📊 Total music library size: {size_mb:.1f} MB")
    except Exception:
        pass
    
    print("🚀 You can now start AzuraCast with: docker-compose up -d")

if __name__ == "__main__":
    main()