# Liquidsoap script for Bernie Radio

set("log.file.path", "/app/liquidsoap.log")
set("log.level", 3)
set("server.telnet", false)
set("server.http", false)

def get_playlist() =
    # Fetch the playlist from the new simple text endpoint
    url = "http://localhost:8001/playlist.txt"
    log("Fetching playlist from: " ^ url)
    
    # request.lines fetches a URL and returns a list of strings.
    files = request.lines(url)
    
    # Log the fetched files for debugging
    if list.length(files) > 0 then
        log("Fetched " ^ string.of_int(list.length(files)) ^ " songs.")
    else
        log("Warning: Playlist is empty.")
    end
    
    # The files are already shuffled by the API, but we can shuffle again
    files = list.shuffle(files)
    files
end

def build_source() =
    playlist_files = get_playlist()
    
    if list.length(playlist_files) == 0 then
        log("Playlist is empty, falling back to silence.")
        # Return a source that will be silent
        single("/dev/zero")
    else
        # Create a playlist source from the list of files
        playlist(id="main_playlist", reload_mode="rounds", playlist_files)
    end
end

# Main radio source with crossfade
radio = build_source()
radio = crossfade(radio, 2.0)

# Output to Icecast
output.icecast(
  %mp3,
  host = "localhost",
  port = 8000,
  password = "hackme",
  mount = "/stream",
  name = "Bernie Radio",
  description = "The music of Bernie Chiaravalle",
  genre = "Rock",
  url = "http://bernieradio.com",
  public = true,
  radio
) 