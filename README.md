# Bernie Radio Stream

A livestream radio application for Bernie Chiaravalle's music collection, built with FastAPI, Icecast, and Docker.

## Features

- **Continuous Streaming**: Plays songs from Bernie's collection in random order
- **REST API**: Full API for managing the stream and playlist
- **Album Artwork**: Automatic album artwork mapping
- **Unreleased Tracks**: Special handling for unreleased tracks
- **Docker Deployment**: Easy deployment with Docker and Docker Compose

## API Endpoints

### Stream Management
- `GET /` - API status
- `GET /status` - Current stream status
- `POST /start` - Start the stream
- `POST /stop` - Stop the stream

### Playlist Management
- `GET /songs` - List all songs
- `GET /playlist` - Get current playlist with next 25 songs
- `POST /skip` - Skip current song
- `POST /play/{song_id}` - Play specific song by ID
- `POST /reshuffle` - Generate new shuffled playlist

## Quick Start

### Using Docker Compose (Recommended)

1. Clone the repository:
```bash
git clone <repository-url>
cd bernie-radio-stream
```

2. Build and start the application:
```bash
docker-compose up -d
```

3. The stream will be available at:
   - Stream: `http://localhost:8000/stream`
   - API: `http://localhost:8001`

### Manual Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Install system dependencies:
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install ffmpeg icecast2

# macOS
brew install ffmpeg icecast
```

3. Start the application:
```bash
python app.py
```

## Configuration

### Environment Variables

- `PYTHONUNBUFFERED=1` - Enable unbuffered Python output
- `ICECAST_PASSWORD=hackme` - Icecast source password (default)

### Ports

- `8000` - Icecast stream server
- `8001` - FastAPI application

## Deployment on Digital Ocean

1. Create a new droplet (Ubuntu 22.04 recommended)

2. SSH into your droplet:
```bash
ssh root@your-droplet-ip
```

3. Install Docker and Docker Compose:
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
sudo usermod -aG docker $USER
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

4. Clone and deploy the application:
```bash
git clone <repository-url>
cd bernie-radio-stream
docker-compose up -d
```

5. Configure firewall (optional):
```bash
sudo ufw allow 8000
sudo ufw allow 8001
sudo ufw enable
```

## Stream URLs

Once deployed, the stream will be available at:
- **Stream URL**: `http://your-server-ip:8000/stream`
- **API URL**: `http://your-server-ip:8001`

## Frontend Integration

The original HTML interface can be modified to connect to the stream by changing the audio source:

```javascript
// Replace the Howl.js audio with stream URL
const streamUrl = 'http://your-server-ip:8000/stream';
const audio = new Audio(streamUrl);
audio.play();
```

## Monitoring

### Logs
```bash
# View application logs
docker-compose logs -f bernie-radio

# View Icecast logs
docker-compose exec bernie-radio tail -f /var/log/icecast2/error.log
```

### Health Check
The application includes a health check endpoint:
```bash
curl http://localhost:8001/
```

## Troubleshooting

### Common Issues

1. **Port already in use**: Make sure ports 8000 and 8001 are available
2. **Icecast not starting**: Check if the icecast user exists and has proper permissions
3. **Stream not playing**: Verify that FFmpeg is installed and working
4. **API not responding**: Check if the FastAPI application is running on port 8001

### Debug Mode

To run in debug mode:
```bash
docker-compose down
docker-compose up  # Remove -d flag to see logs
```

## License

This project is for personal use only. All music rights belong to Bernie Chiaravalle. 