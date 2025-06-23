# Liquidsoap script for Bernie Radio - Continuous Infinite Stream
# Designed for seamless, uninterrupted playback with automatic shuffling

set("log.file.path", "/app/liquidsoap.log")
set("log.level", 3)
set("server.telnet", false)
set("server.http", false)

# Increase some settings for better reliability
set("decoder.file_extensions.ffmpeg",["mp3","m4a","mp4","aac","wav","flac","ogg","opus","wma"])
set("frame.audio.samplerate", 44100)
set("frame.audio.channels", 2)

# Function to fetch and shuffle the playlist
def get_shuffled_playlist() =
    url = "http://localhost:8001/playlist.txt"
    log("Fetching playlist from: " ^ url)
    
    # Fetch the playlist
    files = request.lines(url)
    
    if list.length(files) > 0 then
        log("Fetched " ^ string.of_int(list.length(files)) ^ " songs.")
        # Shuffle the playlist for variety
        shuffled = list.shuffle(files)
        log("Playlist shuffled successfully.")
        shuffled
    else
        log("Warning: Playlist is empty.")
        []
    end
end

# Create a dynamic playlist that refreshes automatically
# The reload parameter ensures we refetch the playlist when it ends
dynamic_playlist = playlist(
    id="bernie_radio_playlist",
    mode="normal",
    reload_mode="watch",
    reload=1,
    mime_type="audio/mpeg",
    get_shuffled_playlist()
)

# Add a fallback with emergency broadcast in case playlist fails
emergency = single("/app/silence.mp3")

# Create a safe source that always has something to play
safe_source = fallback(
    track_sensitive=false,
    [dynamic_playlist, emergency]
)

# Function to create an infinite looping source
def create_infinite_source() =
    # Create multiple playlist instances with different shuffle orders
    playlist1 = playlist(
        id="playlist1",
        mode="randomize",
        reload_mode="watch", 
        reload=1,
        get_shuffled_playlist()
    )
    
    playlist2 = playlist(
        id="playlist2", 
        mode="randomize",
        reload_mode="watch",
        reload=1,
        get_shuffled_playlist()
    )
    
    playlist3 = playlist(
        id="playlist3",
        mode="randomize",
        reload_mode="watch",
        reload=1,
        get_shuffled_playlist()
    )
    
    # Rotate between playlists to ensure continuous variety
    rotate(
        weights=[1,1,1],
        [playlist1, playlist2, playlist3]
    )
end

# Create the main infinite source
infinite_source = create_infinite_source()

# Add smooth crossfading between tracks
radio = crossfade(
    duration=3.0,
    fade_in=2.0,
    fade_out=2.0,
    infinite_source
)

# Add audio processing for consistent output
radio = normalize(radio)

# Enable request queue for manual song additions if needed
request_queue = request.queue(id="request")

# Combine with request queue
radio_with_requests = fallback(
    track_sensitive=false,
    [request_queue, radio]
)

# Final source with all fallbacks
final_radio = fallback(
    track_sensitive=false,
    [radio_with_requests, safe_source]
)

# Add metadata updates
def update_metadata(m) =
    title = m["title"]
    artist = m["artist"] 
    if title != "" then
        log("Now playing: " ^ artist ^ " - " ^ title)
        # You can add HTTP calls here to update external metadata
    end
end

final_radio = on_metadata(update_metadata, final_radio)

# Output to Icecast with reconnection on failure
output.icecast(
    %mp3(bitrate=128),
    host = "localhost",
    port = 8000,
    password = "hackme",
    mount = "/stream",
    name = "Bernie Radio",
    description = "The music of Bernie Chiaravalle - 24/7 Continuous Stream",
    genre = "Rock",
    url = "http://bernieradio.com",
    public = true,
    icy_metadata="true",
    reconnect=true,
    reconnect_delay=2.0,
    final_radio
) 