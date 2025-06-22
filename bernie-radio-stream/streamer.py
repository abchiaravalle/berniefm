#!/usr/bin/env python3
"""
Audio streamer for Bernie Radio
Downloads songs from S3 and streams them to Icecast server
"""

import subprocess
import time
import requests
import tempfile
import os
import sys
import json
from urllib.parse import urlparse
import threading
from datetime import datetime

# Global variables
current_song = None
stream_process = None
icecast_url = "http://localhost:8000/stream"
icecast_password = "hackme"

API_URL = "http://localhost:8001"
ICECAST_URL = "icecast://source:hackme@localhost:8000/stream"

def download_song(url, temp_dir):
    """Download a song from S3 to temporary file"""
    try:
        print(f"Downloading: {url}")
        response = requests.get(url, stream=True)
        response.raise_for_status()
        
        # Create temporary file
        filename = os.path.basename(urlparse(url).path)
        temp_file = os.path.join(temp_dir, filename)
        
        with open(temp_file, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        print(f"Downloaded: {temp_file}")
        return temp_file
    except Exception as e:
        print(f"Error downloading {url}: {e}")
        return None

def stream_song(song):
    """Stream a single song to Icecast using ffmpeg."""
    # The 'song' object is now a dictionary from our API, not just a URL
    title = song.get('title', 'Unknown Title')
    artist = song.get('artist', 'Unknown Artist')
    url = song.get('file_path')

    if not url:
        print("STREAMER: ERROR - Song object does not contain a 'file_path'. Skipping.")
        return

    print(f"STREAMER: Now playing: {title} by {artist}")
    
    # Update Icecast metadata. Note: this is a best-effort call.
    try:
        metadata_url = f"http://localhost:8000/admin/metadata?mount=/stream&mode=updinfo&song={title.replace('&', '%26')}"
        requests.get(metadata_url, auth=('admin', 'hackme'), timeout=2)
    except requests.RequestException as e:
        print(f"STREAMER: INFO - Could not update metadata: {e}")

    ffmpeg_command = [
        'ffmpeg',
        '-re',
        '-i', url,
        '-c:a', 'libmp3lame',
        '-b:a', '128k',
        '-ar', '44100',
        '-ice_name', 'Bernie Radio',
        '-ice_description', 'The music of Bernie Chiaravalle',
        '-ice_genre', 'Rock',
        '-ice_public', '1',
        '-f', 'mp3',
        '-content_type', 'audio/mpeg',
        ICECAST_URL
    ]
        
    process = subprocess.Popen(ffmpeg_command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        
    # Let the song play
    process.wait()

    stderr_output = process.stderr.read().decode()
    if process.returncode != 0:
        if "pipe:1: End of file" not in stderr_output:
             print(f"STREAMER: ffmpeg error for song {title}:\n{stderr_output}")
   
    print(f"STREAMER: Finished streaming {title}.")

def wait_for_api():
    """Wait for the FastAPI server to be ready."""
    print("STREAMER: Waiting for API server to be ready...")
    retries = 0
    max_retries = 12 # Wait for a total of 60 seconds
    while retries < max_retries:
        try:
            response = requests.get(f"{API_URL}/health")
            if response.status_code == 200:
                print("STREAMER: API server is ready.")
                return True
        except requests.ConnectionError:
            pass # Keep trying
        
        print("STREAMER: API not ready, retrying in 5 seconds...")
        retries += 1
        time.sleep(5)
    
    print("STREAMER: ERROR - API server did not become ready in time.")
    return False

def get_playlist():
    """Get the current playlist from the API."""
    try:
        # This endpoint now returns a JSON object with 'now_playing' and 'upcoming'
        response = requests.get(f"{API_URL}/playlist")
        response.raise_for_status()
        playlist_data = response.json()
        return playlist_data.get('now_playing')
    except requests.RequestException as e:
        print(f"STREAMER: Error fetching playlist: {e}")
        return None

def advance_to_next_song():
    """Tell the API to advance to the next song."""
    try:
        response = requests.post(f"{API_URL}/next_song")
        response.raise_for_status()
        print("STREAMER: Advanced to next song in playlist on API.")
    except requests.RequestException as e:
        print(f"STREAMER: Could not advance to next song: {e}")

def main():
    """Main streaming loop."""
    if not wait_for_api():
        return

    while True:
        current_song = get_playlist()
        if current_song:
            stream_song(current_song)
            advance_to_next_song()
        else:
            print("STREAMER: Playlist is empty or unavailable. Waiting...")
            time.sleep(10)

if __name__ == "__main__":
    main() 