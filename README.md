# BC Radio - Livestream Setup

This branch contains the livestream version of BC Radio using AzuraCast for streaming Bernie Chiaravalle's music collection.

## 🎵 What's Included

- **AzuraCast Docker Setup**: Complete radio streaming server
- **Music Download Script**: Automatically downloads all MP3s from the S3 bucket
- **Livestream Interface**: Modified index.html with persistent streaming player
- **Visual Consistency**: Maintains the original design with album art, unreleased tags, etc.

## 🚀 Quick Start

### 1. Download Music Files

First, download all the MP3 files from the S3 bucket:

```bash
python3 download_music.py
```

This will create a `music/` directory with all Bernie Chiaravalle's tracks organized by album.

### 2. Start AzuraCast

Launch the AzuraCast container:

```bash
docker-compose up -d
```

Wait for the container to fully start (this may take a few minutes on first run).

### 3. Access AzuraCast Web Interface

Open your browser and go to:
```
http://localhost
```

You'll be prompted to create an admin account.

## 🎛️ AzuraCast Configuration

### Initial Setup

1. **Create Admin Account**: Follow the setup wizard to create your admin account
2. **Create Station**: You'll need to create a radio station

### Station Configuration

1. **Go to Stations** → **Add Station**
2. **Station Details**:
   - Name: `BC Radio`
   - Description: `Bernie Chiaravalle Live Stream`
   - Genre: `Rock/Pop`
   
3. **Broadcasting Settings**:
   - Frontend: `Icecast 2.4`
   - Backend: `Liquidsoap`
   - Port: `8000` (default)

4. **Mount Points**:
   - Create a mount point at `/listen`
   - Format: `MP3`
   - Bitrate: `128kbps` or higher

### Music Library Setup

1. **Go to Media** → **Music Files**
2. **Upload Music**: The music files should automatically be detected from the `/var/azuracast/www_tmp/music` directory (mapped from `./music`)
3. **Scan for New Files**: Click "Scan for New Files" to import all tracks
4. **Add Metadata**: AzuraCast will automatically read ID3 tags, but you may want to verify:
   - Artist names are consistent
   - Album art is properly displayed
   - Track titles are clean

### Playlist Configuration

1. **Go to Playlists** → **Add Playlist**
2. **Create Main Playlist**:
   - Name: `BC Radio Main`
   - Type: `Standard`
   - Include all tracks
   - Enable shuffle
   - Set to play continuously

3. **Create Album-Specific Playlists** (optional):
   - Create separate playlists for each album
   - Use for scheduled programming

### AutoDJ Settings

1. **Go to AutoDJ** → **Settings**
2. **Configure**:
   - Enable AutoDJ
   - Set crossfade duration (3-5 seconds recommended)
   - Enable playlist shuffling
   - Set the main playlist as default

### Stream Settings

1. **Go to Stations** → **Your Station** → **Profile**
2. **Broadcasting**:
   - Ensure the stream is enabled
   - Check that the mount point is active
   - Test the stream URL: `http://localhost:8000/listen`

## 🎨 Visual Features Maintained

The livestream interface preserves all visual elements from the original:

- ✅ **Album Artwork**: Dynamically updates based on currently playing track
- ✅ **Unreleased Tags**: Shows "UNRELEASED" for tracks from Random mp3s folder
- ✅ **3D CD Case Effect**: Maintains the skeuomorphic album art display
- ✅ **Time Display**: Current time in bottom-left corner
- ✅ **Weather Widget**: Live weather in top-right corner
- ✅ **Social Media Links**: All original social links preserved
- ✅ **Animations**: GSAP animations and Lottie visualizer
- ✅ **Responsive Design**: Mobile-friendly layout
- ✅ **PWA Support**: Add to home screen functionality

## 🔧 Advanced Configuration

### Custom Metadata

To ensure proper display of album art and unreleased tags:

1. **In AzuraCast Media Manager**:
   - Edit tracks from "Random mp3s" folder
   - Set Album field to "Unreleased"
   - Verify artist is "Bernie Chiaravalle"

2. **Album Art**:
   - Upload album covers to each album folder
   - AzuraCast will automatically detect and use them
   - Fallback art is already configured

### Stream Quality

For better quality streaming:

1. **Increase Bitrate**: Go to Station → Mount Points → Edit
2. **Set to 192kbps or 320kbps** for higher quality
3. **Adjust Liquidsoap Settings** for better audio processing

### Scheduling

To create scheduled shows:

1. **Go to Playlists** → **Add Playlist**
2. **Set Type to "Scheduled"**
3. **Configure play times** (e.g., "New Releases Hour" daily at 3 PM)
4. **Add specific tracks** or albums to the scheduled playlist

## 🌐 Going Live

### Domain Setup

To make this accessible on the internet:

1. **Configure Reverse Proxy**: Use nginx or Apache to proxy to AzuraCast
2. **SSL Certificate**: Set up HTTPS with Let's Encrypt
3. **Update Stream URLs**: Change `localhost` to your domain in `index-livestream.html`

### Performance Optimization

For production use:

1. **Resource Limits**: Adjust Docker resource limits in `docker-compose.yml`
2. **Database Optimization**: Configure MySQL/MariaDB settings
3. **CDN**: Consider using a CDN for the web interface
4. **Monitoring**: Set up monitoring for stream uptime

## 📱 Mobile & PWA

The livestream interface is fully PWA-compatible:

- **iOS**: Stream continues in background when added to home screen
- **Android**: Native-like experience with background playback
- **Desktop**: Works in all modern browsers

## 🔍 Troubleshooting

### Stream Not Playing

1. Check AzuraCast container is running: `docker-compose ps`
2. Verify mount point is active in AzuraCast admin
3. Test stream URL directly: `http://localhost:8000/listen`
4. Check browser console for JavaScript errors

### Music Not Showing

1. Ensure music files are in the correct directory: `./music/`
2. Run media scan in AzuraCast: Media → Scan for New Files
3. Check file permissions on the music directory
4. Verify Docker volume mapping in `docker-compose.yml`

### Album Art Not Displaying

1. Check that album art images are in the music folders
2. Verify AzuraCast has processed the album art
3. Check API response at `http://localhost:8000/api/nowplaying`
4. Ensure CORS is properly configured

## 🎯 Next Steps

1. **Download Music**: Run `python3 download_music.py`
2. **Start Services**: Run `docker-compose up -d`
3. **Configure AzuraCast**: Follow the setup wizard
4. **Import Music**: Scan and organize your music library
5. **Test Stream**: Open `index-livestream.html` and test playback
6. **Customize**: Adjust playlists, scheduling, and metadata as needed

## 📞 Support

For AzuraCast-specific issues, refer to the [AzuraCast Documentation](https://docs.azuracast.com/).

For BC Radio customization questions, check the code comments in `index-livestream.html`.

---

🎵 **Enjoy your Bernie Chiaravalle livestream!** 🎵