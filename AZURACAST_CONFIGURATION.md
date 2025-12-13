# AzuraCast Configuration Guide for BC Radio

This document provides step-by-step instructions for configuring AzuraCast after the initial setup.

## 🚀 Initial Setup (After running setup.sh)

### 1. Access AzuraCast Admin Panel

1. Open your browser and go to `http://localhost`
2. You'll see the AzuraCast setup wizard
3. Create your admin account:
   - **Username**: Choose your admin username
   - **Email**: Your email address
   - **Password**: Strong password

### 2. Create Your Radio Station

1. Click **"Add Station"**
2. Fill in the station details:
   - **Name**: `BC Radio`
   - **Description**: `Bernie Chiaravalle Live Stream`
   - **Genre**: `Rock/Pop`
   - **URL**: `https://www.berniechiaravalle.com`
   - **Timezone**: Select your timezone

3. **Broadcasting Configuration**:
   - **AutoDJ Service**: `Liquidsoap`
   - **Broadcasting Service**: `Icecast 2.4`
   - **Broadcasting Port**: `8000`

4. Click **"Create Station"**

## 🎵 Music Library Setup

### 1. Import Music Files

1. Go to **Stations** → **BC Radio** → **Media**
2. Click **"Scan for New Files"**
3. Wait for the scan to complete (this may take several minutes)
4. You should see all Bernie Chiaravalle's tracks organized by album

### 2. Verify Metadata

1. Review the imported tracks for:
   - **Artist**: Should be "Bernie Chiaravalle" for most tracks
   - **Album**: Check album names are correct
   - **Title**: Verify song titles are clean
   - **Album Art**: Should be automatically detected

2. For tracks from "Random mp3s" folder:
   - Edit each track individually
   - Set **Album** to "Unreleased"
   - Ensure **Artist** is "Bernie Chiaravalle"

## 🎛️ Mount Point Configuration

### 1. Create the Stream Mount Point

1. Go to **Stations** → **BC Radio** → **Mount Points**
2. Click **"Add Mount Point"**
3. Configure:
   - **Mount Point Name**: `/listen`
   - **Display Name**: `BC Radio Live Stream`
   - **Format**: `MP3`
   - **Bitrate**: `128kbps` (or higher for better quality)
   - **Enable**: ✅ Yes
   - **Default Mount**: ✅ Yes

4. Click **"Save Changes"**

## 📻 Playlist Configuration

### 1. Create Main Playlist

1. Go to **Stations** → **BC Radio** → **Playlists**
2. Click **"Add Playlist"**
3. Configure:
   - **Name**: `BC Radio Main`
   - **Type**: `Standard`
   - **Source**: `Songs`
   - **Order**: `Shuffle`
   - **Include in Requests**: ✅ Yes
   - **Include in On-Demand Player**: ✅ Yes

4. **Add all tracks** to this playlist:
   - Click **"Edit"** on the playlist
   - Go to **"Manage Songs"**
   - Select all tracks and add them

### 2. Create Album-Specific Playlists (Optional)

For each major album, create separate playlists:

1. **Driven By Desire Playlist**
2. **Chiaro Destino Playlist**
3. **Hideaway Tales Playlist**
4. **Life As We Know It Playlist**
5. **Unreleased Collection Playlist** (for Random mp3s)

This allows for scheduled programming later.

## 🤖 AutoDJ Configuration

### 1. Enable AutoDJ

1. Go to **Stations** → **BC Radio** → **AutoDJ**
2. Enable **"Enable AutoDJ"**
3. Configure settings:
   - **Crossfade Duration**: `3.0` seconds
   - **Apply Compression**: ✅ Yes (for consistent volume)
   - **Enable ReplayGain**: ✅ Yes (for volume normalization)

### 2. Set Default Playlist

1. In AutoDJ settings, set **"Default Playlist"** to `BC Radio Main`
2. Enable **"Loop Playlist"** to ensure continuous playback
3. Set **"Playlist Weight"** to `1` (highest priority)

## 🔧 Advanced Configuration

### 1. Stream Quality Settings

For higher quality streaming:

1. Go to **Mount Points** → **Edit `/listen`**
2. Change **Bitrate** to `192kbps` or `320kbps`
3. Adjust **Max Listeners** based on your server capacity

### 2. Liquidsoap Configuration

For advanced audio processing:

1. Go to **Stations** → **BC Radio** → **Broadcasting**
2. Click **"Edit Liquidsoap Configuration"**
3. You can add custom audio processing here (optional)

### 3. Album Art Configuration

1. Go to **System Settings** → **Services**
2. Enable **"Album Art Processing"**
3. Set **"Album Art Resolution"** to `500x500` or higher

## 📅 Scheduling (Optional)

### 1. Create Scheduled Shows

Example: "New Releases Hour" daily at 3 PM

1. Create a new playlist:
   - **Name**: `New Releases Hour`
   - **Type**: `Scheduled`
   - **Schedule**: Daily at 3:00 PM for 1 hour

2. Add only unreleased tracks to this playlist

### 2. Special Programming

Create themed hours:
- **"Album Spotlight"**: Feature one album per hour
- **"Deep Cuts"**: Less popular tracks
- **"Fan Favorites"**: Most requested songs

## 🌐 API and Integration

### 1. Enable API Access

1. Go to **System Settings** → **API Keys**
2. Create a new API key for external integrations
3. This allows the `index-livestream.html` to fetch now-playing information

### 2. CORS Configuration

For web player integration:

1. Go to **System Settings** → **Security**
2. Add your domain to **"Allowed CORS Origins"**
3. For local testing, add `http://localhost` and `file://`

## 🎯 Testing Your Setup

### 1. Test the Stream

1. Go to **Stations** → **BC Radio** → **Profile**
2. Click **"Listen"** to test the stream
3. Verify the stream URL: `http://localhost:8000/listen`

### 2. Test the Web Player

1. Open `index-livestream.html` in your browser
2. Click **"START STREAM"**
3. Verify:
   - Stream plays correctly
   - Current song information updates
   - Album art changes with tracks
   - Volume control works

### 3. Verify Metadata

1. Check that **"Now Playing"** information appears correctly
2. Verify album art displays for different albums
3. Confirm "UNRELEASED" tag appears for Random mp3s tracks

## 🔍 Troubleshooting

### Stream Not Starting

1. Check **Stations** → **BC Radio** → **Logs**
2. Verify mount point is **"Connected"**
3. Ensure AutoDJ is **"Running"**

### No Music Playing

1. Verify playlists have songs added
2. Check that AutoDJ is enabled
3. Ensure default playlist is set

### Album Art Not Showing

1. Check **Media** → **Album Art** processing
2. Verify API is accessible at `http://localhost:8000/api/nowplaying`
3. Check browser console for CORS errors

## 🎉 You're Ready!

Once configured, your BC Radio livestream will:

- ✅ Stream continuously with all Bernie Chiaravalle's music
- ✅ Display proper album art and metadata
- ✅ Show "UNRELEASED" tags for unreleased tracks
- ✅ Provide a beautiful, responsive web interface
- ✅ Work on mobile devices and as a PWA
- ✅ Maintain all the visual elements of the original design

**Enjoy your Bernie Chiaravalle livestream!** 🎵