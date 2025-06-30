#!/usr/bin/env python3
"""
Download all MP3 files from Bernie Chiaravalle's S3 bucket for AzuraCast streaming.
This script extracts MP3 URLs from index.html and downloads them to the music directory.
"""

import os
import re
import urllib.request
import urllib.parse
from pathlib import Path
import time

def extract_mp3_urls_from_html():
    """Extract all MP3 URLs from index.html"""
    mp3_urls = []
    
    with open('index.html', 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Find all lines with .mp3 URLs
    mp3_pattern = r'`\${base}([^`]+\.mp3)`'
    matches = re.findall(mp3_pattern, content)
    
    base_url = "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/"
    
    for match in matches:
        full_url = base_url + match
        mp3_urls.append(full_url)
    
    return mp3_urls

def download_file(url, local_path):
    """Download a file from URL to local path"""
    try:
        # Create directory if it doesn't exist
        local_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Skip if file already exists
        if local_path.exists():
            print(f"✓ Already exists: {local_path}")
            return True
            
        print(f"📥 Downloading: {url}")
        urllib.request.urlretrieve(url, local_path)
        print(f"✅ Downloaded: {local_path}")
        return True
        
    except Exception as e:
        print(f"❌ Failed to download {url}: {e}")
        return False

def main():
    """Main function to download all MP3 files"""
    print("🎵 Bernie Chiaravalle Music Downloader for AzuraCast")
    print("=" * 60)
    
    # Create music directory
    music_dir = Path("music")
    music_dir.mkdir(exist_ok=True)
    
    # Extract MP3 URLs
    print("📋 Extracting MP3 URLs from index.html...")
    mp3_urls = extract_mp3_urls_from_html()
    print(f"Found {len(mp3_urls)} MP3 files to download")
    
    # Download each file
    downloaded = 0
    failed = 0
    
    for i, url in enumerate(mp3_urls, 1):
        print(f"\n[{i}/{len(mp3_urls)}]", end=" ")
        
        # Parse URL to create local path
        parsed_url = urllib.parse.urlparse(url)
        # Remove the base path to get relative path
        relative_path = parsed_url.path.replace('/Bernie%20Chiaravalle/', '')
        # Decode URL encoding
        relative_path = urllib.parse.unquote(relative_path)
        
        local_path = music_dir / relative_path
        
        if download_file(url, local_path):
            downloaded += 1
        else:
            failed += 1
            
        # Small delay to be respectful to the server
        time.sleep(0.1)
    
    print(f"\n🎉 Download complete!")
    print(f"✅ Successfully downloaded: {downloaded} files")
    if failed > 0:
        print(f"❌ Failed downloads: {failed} files")
    
    print(f"\n📁 All music files are now in the 'music' directory")
    print("🚀 You can now start AzuraCast with: docker-compose up -d")

if __name__ == "__main__":
    main()