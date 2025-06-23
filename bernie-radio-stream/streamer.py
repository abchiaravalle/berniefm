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
import random
from urllib.parse import urlparse
import threading
from datetime import datetime

# Global variables
current_song = None
stream_process = None
icecast_url = "http://localhost:8000/stream"
icecast_password = "hackme"

API_URL = "http://localhost:8001"
ICECAST_URL = "icecast://source:hackme@100.100.9.95:8000/stream"

def validate_song_url(url):
    """Validate that a song URL is accessible before attempting to stream."""
    try:
        print(f"STREAMER: Validating URL: {url}")
        # Use HEAD request to check if the file is accessible without downloading
        response = requests.head(url, timeout=10)
        
        if response.status_code == 200:
            print(f"STREAMER: URL validation successful (Status: {response.status_code})")
            return True
        else:
            print(f"STREAMER: URL validation failed - Status: {response.status_code}")
            return False
            
    except requests.RequestException as e:
        print(f"STREAMER: URL validation failed - Request error: {e}")
        return False
    except Exception as e:
        print(f"STREAMER: URL validation failed - Unexpected error: {e}")
        return False

def get_all_songs():
    """Get all available songs from the API."""
    try:
        response = requests.get(f"{API_URL}/songs")  # Assuming there's an endpoint to get all songs
        response.raise_for_status()
        return response.json()
    except requests.RequestException:
        # Fallback: try to get songs from playlist and expand
        try:
            response = requests.get(f"{API_URL}/playlist")
            response.raise_for_status()
            playlist_data = response.json()
            
            songs = []
            if playlist_data.get('now_playing'):
                songs.append(playlist_data['now_playing'])
            if playlist_data.get('upcoming'):
                songs.extend(playlist_data['upcoming'])
            
            # Try to get more songs by requesting next songs multiple times
            for _ in range(5):  # Get more songs to build a larger pool
                try:
                    response = requests.post(f"{API_URL}/next_song")
                    if response.status_code == 200:
                        new_playlist = requests.get(f"{API_URL}/playlist").json()
                        if new_playlist.get('now_playing') and new_playlist['now_playing'] not in songs:
                            songs.append(new_playlist['now_playing'])
                except:
                    break
            
            return songs
        except requests.RequestException as e:
            print(f"STREAMER: Error fetching songs: {e}")
            return []

def create_shuffled_playlist():
    """Create a new shuffled playlist of valid songs."""
    all_songs = get_all_songs()
    if not all_songs:
        print("STREAMER: No songs available")
        return []
    
    # Filter valid songs
    valid_songs = []
    for song in all_songs:
        if validate_song_url(song.get('file_path')):
            valid_songs.append(song)
        else:
            print(f"STREAMER: Skipping '{song.get('title', 'Unknown')}' - URL validation failed")
    
    if not valid_songs:
        print("STREAMER: No valid songs found")
        return []
    
    # Shuffle the playlist
    random.shuffle(valid_songs)
    print(f"STREAMER: Created shuffled playlist with {len(valid_songs)} songs")
    
    return valid_songs

def stream_song_seamlessly(song):
    """Stream a single song seamlessly to Icecast."""
    title = song.get('title', 'Unknown Title')
    artist = song.get('artist', 'Unknown Artist')
    url = song.get('file_path')

    if not url:
        print("STREAMER: ERROR - Song object does not contain a 'file_path'. Skipping.")
        return False

    print(f"STREAMER: Now playing: {title} by {artist}")
    
    # Update Icecast metadata
    try:
        metadata_url = f"http://100.100.9.95:8000/admin/metadata?mount=/stream&mode=updinfo&song={title.replace('&', '%26')}"
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
    
    print(f"STREAMER: Starting ffmpeg stream for '{title}'")
    process = subprocess.Popen(ffmpeg_command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    
    print(f"STREAMER: ffmpeg process started with PID: {process.pid}")
    
    # Wait for the song to finish
    process.wait()
    
    stderr_output = process.stderr.read().decode()
    if process.returncode != 0:
        if "pipe:1: End of file" not in stderr_output:
            print(f"STREAMER: ffmpeg error for song {title}:\n{stderr_output}")
            return False
    
    print(f"STREAMER: Finished streaming {title}")
    return True

def stream_continuously():
    """Stream continuously with new shuffled playlists after each song."""
    print("STREAMER: Starting continuous seamless stream")
    
    while True:
        # Create new shuffled playlist
        playlist = create_shuffled_playlist()
        if not playlist:
            print("STREAMER: No songs available, waiting...")
            time.sleep(10)
            continue
        
        print(f"STREAMER: Starting new shuffled playlist with {len(playlist)} songs")
        
        # Stream each song in the shuffled playlist
        for song in playlist:
            success = stream_song_seamlessly(song)
            if not success:
                print(f"STREAMER: Failed to stream song, continuing to next...")
                continue
            
            # After each song, create a new shuffled playlist for variety
            print("STREAMER: Song completed, creating new shuffled playlist...")
            break  # Exit the playlist loop to create a new shuffled playlist

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

def main():
    """Main streaming loop."""
    if not wait_for_api():
        return

    # Start continuous streaming
    stream_continuously()

if __name__ == "__main__":
    main() 