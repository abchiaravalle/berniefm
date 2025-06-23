# Bernie Radio - Continuous Livestream Branch

This branch implements a continuous, infinite music streaming system that never requires manual restarts.

## Overview

The livestream system uses Liquidsoap for audio streaming, providing:
- **Continuous playback** - Never stops or requires manual intervention
- **Automatic shuffling** - Songs play in random order with variety
- **Multiple fallback layers** - Ensures uninterrupted streaming
- **Automatic reconnection** - Reconnects to Icecast if connection drops
- **Smooth crossfading** - 3-second crossfades between tracks

## Architecture

### Components
1. **Liquidsoap** (`bernie-radio.liq`) - Audio streaming engine
2. **FastAPI Backend** (`app.py`) - Provides playlist and metadata
3. **Icecast Server** - Broadcasts the stream
4. **SQLite Database** - Stores song metadata
5. **Supervisor** - Manages all services

### Key Features
- **Triple Playlist Sources**: Three separate randomized playlists rotate to ensure variety
- **Dynamic Playlist Reloading**: Automatically refreshes playlist from API
- **Emergency Fallback**: Plays silence file if all sources fail
- **Request Queue**: Supports manual song additions
- **Audio Normalization**: Consistent volume levels

## Getting Started

### Prerequisites
- Docker and Docker Compose installed
- Port 8000 (Icecast) and 8001 (API) available

### Running the Stream

1. Clone the repository and checkout the livestream branch:
```bash
git clone <repository-url>
cd bernie-radio
git checkout livestream
```

2. Start the services:
```bash
docker-compose up -d
```

3. Access the stream:
- Stream URL: `http://localhost:8000/stream`
- API: `http://localhost:8001`

### Monitoring

Check service logs:
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f berniefm
```

Check Liquidsoap logs inside container:
```bash
docker exec -it bernie-radio tail -f /var/log/supervisor/liquidsoap.log
```

## Configuration

### Liquidsoap Settings (`bernie-radio.liq`)

Key configuration options:
- `crossfade duration`: 3 seconds (adjustable)
- `reconnect_delay`: 2 seconds
- `reload`: 1 (automatic playlist refresh)

### Stream Quality
- Bitrate: 128 kbps MP3
- Sample Rate: 44.1 kHz
- Channels: Stereo

## API Endpoints

- `GET /playlist.txt` - Returns plain text list of song URLs
- `GET /` - Health check
- Additional endpoints documented in `app.py`

## Troubleshooting

### Stream Not Starting
1. Check if all services are running:
```bash
docker-compose ps
```

2. Verify Icecast is accessible:
```bash
curl http://localhost:8000/status-json.xsl
```

3. Check API is responding:
```bash
curl http://localhost:8001/playlist.txt
```

### Audio Issues
- Ensure all source files are valid MP3/M4A format
- Check Liquidsoap logs for decoder errors
- Verify the silence.mp3 fallback file exists

### Continuous Operation
The system is designed to run indefinitely without intervention. If issues occur:
1. The supervisor will automatically restart failed services
2. Liquidsoap will reconnect to Icecast if disconnected
3. Multiple playlist sources ensure continuous playback

## Development

### Testing Changes
1. Modify the Liquidsoap configuration
2. Rebuild and restart:
```bash
docker-compose down
docker-compose build
docker-compose up -d
```

### Adding Features
- Request queue is available for live song additions
- Metadata updates can be extended in the `update_metadata` function
- Additional audio processing can be added to the signal chain

## Architecture Details

### Playlist Flow
1. FastAPI serves playlist from database
2. Liquidsoap fetches and shuffles playlist
3. Three playlist instances with different shuffle orders
4. Rotation between sources for variety
5. Automatic reload when playlist ends

### Fallback Hierarchy
1. Request queue (manual additions)
2. Main rotating playlists
3. Dynamic playlist with watch mode
4. Emergency silence file

This ensures the stream never stops, even in edge cases.