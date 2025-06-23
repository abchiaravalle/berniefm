# This is a placeholder file for the FastAPI application. 

import asyncio
import random
import subprocess
import threading
from datetime import datetime
from typing import List, Optional
from urllib.parse import unquote

from fastapi import FastAPI, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict
from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import sessionmaker, Session, relationship
from sqlalchemy.ext.declarative import declarative_base

# --- Basic Setup ---
DATABASE_URL = "sqlite:///./data/radio.db"
Base = declarative_base()
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

app = FastAPI(
    title="BernieFM API",
    description="API for controlling the BernieFM stream, managing playlists, and serving track info.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Database Models ---
class Song(Base):
    __tablename__ = "songs"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True)
    artist = Column(String)
    album = Column(String)
    file_path = Column(String, unique=True)
    album_art_url = Column(String)
    unreleased = Column(Boolean, default=False)
    playlist_entries = relationship("PlaylistEntry", back_populates="song")

class PlaylistEntry(Base):
    __tablename__ = "playlist"
    id = Column(Integer, primary_key=True, index=True)
    song_id = Column(Integer, ForeignKey("songs.id"), index=True)
    play_order = Column(Integer)
    played_at = Column(DateTime, nullable=True)
    is_playing = Column(Boolean, default=False, index=True)
    song = relationship("Song", back_populates="playlist_entries")

# --- Pydantic Schemas ---
class SongResponse(BaseModel):
    id: int
    title: str
    artist: str
    album: str
    album_art_url: str
    unreleased: bool
    file_path: str

    model_config = ConfigDict(from_attributes=True)

class PlaylistResponse(BaseModel):
    now_playing: Optional[SongResponse]
    upcoming: List[SongResponse]

# --- Database Dependency ---
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- Data Initialization ---
def get_album_from_path(song_path: str) -> str:
    try:
        return song_path.split('/')[-2].replace('%20', ' ')
    except IndexError:
        return "Unknown Album"

def get_album_art_url(album_name: str) -> str:
    base_url = 'https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/cd%20covers/'
    album_art_map = {
        'Driven By Desire': 'Driven%20by%20Desire.jpg',
        'Chiaro Destino mp3 version': 'Chiaro%20Destino.jpg',
        'Random mp3s': 'All%20or%20Nothing.jpg',
        'Here_There_and_Everywhere': 'Here%20There%20and%20Everywhere.jpg',
        'Julian': 'Julian.jpg',
        'Hideaway Tales': 'Hideaway%20Tales.jpg',
        'Life As We Know It': 'Life%20As%20We%20Know%20It.jpg',
        'Long Before I Knew You mp3s': 'Long%20Before%20I%20Knew%20You.png',
        'Make Some Sense of This': 'Make%20Some%20Sense%20of%20This.jpg',
        'More To This Life mp3 version': 'More%20To%20This%20Life.jpg',
        'Mystery of Love': 'Mystery%20of%20Love.jpg',
        'One Bright Moment': 'One%20Bright%20Moment.jpg',
        'Remnants mp3 version': 'Remnants.jpg',
        'The World Around Me': 'This%20Is%20What%20I%20See.jpg',
        'Weddington Street': 'Page%20One.jpg',
        'Winnie\'s Song': 'Winnie%27s%20Song.jpg',
        'Affair_mp3Version': 'Affair%20of%20the%20Heart.jpg',
        'All in Your Mind': 'All%20in%20Your%20Mind.jpg',
        'Miracle River': 'Miracle%20River.jpg'
    }
    artwork_file = album_art_map.get(album_name)
    if artwork_file:
        return base_url + artwork_file
    return base_url + 'All%20or%20Nothing.jpg'

def get_clean_title(file_path: str) -> str:
    # Use unquote to handle all URL-encoded characters like %20, etc.
    filename = unquote(file_path.split('/')[-1])

    is_random_mp3 = "/Random%20mp3s/" in file_path

    if is_random_mp3:
        # For random files, keep the extension
        title = filename
    else:
        # For regular album tracks, remove the extension
        title = ".".join(filename.split('.')[:-1])

    # Common cleaning for all titles
    # Remove leading track numbers (e.g., "01 ", "02 ")
    parts = title.split(' ')
    if len(parts) > 1 and parts[0].isdigit() and len(parts[0]) <= 2:
        title = " ".join(parts[1:])

    # Replace underscores and hyphens with spaces
    title = title.replace('_', ' ').replace('-', ' ').strip()

    # Check for unreleased tag in original filename
    if 'unreleased' in unquote(file_path.split('/')[-1]).lower():
        title = title.replace('unreleased', '').strip()

    return title

def get_song_data_from_source():
    audio_files = [
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Driven%20By%20Desire/01%20Miss%20That%20Train%20%28Catch%20That%20Dream%29.m4a",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Driven%20By%20Desire/02%20Writing%20a%20Romance.m4a",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Driven%20By%20Desire/03%20Man%20Who%20Would%20Be%20King.m4a",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Driven%20By%20Desire/04%20Down%20Down%20Down.m4a",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Driven%20By%20Desire/05%20It%20Was%20Only%20Love.m4a",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Driven%20By%20Desire/06%20All%20Things%20Considered.m4a",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Driven%20By%20Desire/07%20Not%20Without%20a%20Fight.m4a",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Driven%20By%20Desire/08%20Someone%20to%20Hold.m4a",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Driven%20By%20Desire/09%20Let%20Me%20Be%20the%20One.m4a",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Driven%20By%20Desire/10%20From%20Now%20On.m4a",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Chiaro%20Destino%20mp3%20version/01%20Things%20We%20Said%20Today.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Chiaro%20Destino%20mp3%20version/02%20My%20Back%20Pages.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Chiaro%20Destino%20mp3%20version/03%20Isnt%20It%20A%20Pity.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Chiaro%20Destino%20mp3%20version/04%20Dino%27s%20Song.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Chiaro%20Destino%20mp3%20version/05%20You%27ve%20Got%20To%20Hide%20Your%20Love%20Away.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Chiaro%20Destino%20mp3%20version/06%20All%20the%20Children%20Sing.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Chiaro%20Destino%20mp3%20version/07%20Four%20Days%20Gone.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Chiaro%20Destino%20mp3%20version/08%20Happier%20Than%20the%20Morning%20Sun.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Chiaro%20Destino%20mp3%20version/09%20Long%20Long%20Time.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Chiaro%20Destino%20mp3%20version/10%20Angel.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Chiaro%20Destino%20mp3%20version/11%20Laughing.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Chiaro%20Destino%20mp3%20version/12%20I%20Want%20To%20Tell%20You.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Chiaro%20Destino%20mp3%20version/13%20Motor%20of%20Love.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Chiaro%20Destino%20mp3%20version/14%20Love.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Random%20mp3s/a%20loss%20for%20words_march5-unreleased.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Random%20mp3s/allnight_watchman_nov25mix-unreleased.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Random%20mp3s/BegYourForgiveness_march27mix-unreleased.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Random%20mp3s/ByHeart_RealLove-unreleased.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Random%20mp3s/Don%27t_Make_Promise_jan13mix-unreleased.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Random%20mp3s/I%27ll_Get_Back_To_You_april7mix_m-unreleased.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Random%20mp3s/KeepThisTrain-unreleased.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Random%20mp3s/looking_for_love2024_dec11mix-unreleased.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Random%20mp3s/obsession_blues_bc_april7mox-unreleased.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Random%20mp3s/What_We%27ve_Got-unreleased.mp3",
        "https://web-assets-acwebdev.s3.amazonaws.com/Bernie%20Chiaravalle/Random%20mp3s/whenitcomestolovesept24_emastered-unreleased.mp3",
    ]
    song_list = []
    for path in audio_files:
        album = get_album_from_path(path)
        is_unreleased = 'unreleased' in path.lower()
        song_list.append(
            Song(
                title=get_clean_title(path),
                album=album if not is_unreleased else "UNRELEASED",
                artist="Bernie Chiaravalle",
                file_path=path,
                album_art_url=get_album_art_url(album),
                unreleased=is_unreleased
            )
        )
    return song_list

# --- Playlist Logic ---
def generate_new_playlist(db: Session):
    print("Generating new shuffled playlist...")
    db.query(PlaylistEntry).delete()
    all_songs = db.query(Song).all()
    song_ids = [song.id for song in all_songs]
    random.shuffle(song_ids)

    playlist_entries = []
    for i, song_id in enumerate(song_ids):
        playlist_entries.append(PlaylistEntry(song_id=song_id, play_order=i))
    
    if playlist_entries:
        playlist_entries[0].is_playing = True

    db.add_all(playlist_entries)
    db.commit()
    print("New playlist generated.")

@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # Check if DB is empty
        if db.query(Song).count() == 0:
            print("Database is empty. Populating songs...")
            songs_to_add = get_song_data_from_source()
            for song in songs_to_add:
                existing_song = db.query(Song).filter(Song.file_path == song.file_path).first()
                if not existing_song:
                    db.add(song)
            db.commit()
            print(f"Added {len(songs_to_add)} songs to the database.")

        if db.query(PlaylistEntry).count() == 0:
            generate_new_playlist(db)

    finally:
        db.close()

# --- API Endpoints ---
@app.get("/")
def read_root():
    return {"message": "Welcome to BernieFM API"}

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.get("/songs", response_model=List[SongResponse])
def get_all_songs(db: Session = Depends(get_db)):
    """
    Retrieve a list of all songs available in the library.
    """
    return db.query(Song).all()

@app.get("/playlist", response_model=PlaylistResponse)
def get_current_playlist(db: Session = Depends(get_db)):
    """
    Get the current playlist, including the currently playing song and the list of upcoming songs.
    """
    now_playing_entry = db.query(PlaylistEntry).filter(PlaylistEntry.is_playing == True).first()
    if not now_playing_entry:
        # If nothing is playing, regenerate the playlist
        generate_new_playlist(db)
        now_playing_entry = db.query(PlaylistEntry).filter(PlaylistEntry.is_playing == True).first()
        if not now_playing_entry:
            raise HTTPException(status_code=404, detail="Playlist is empty.")

    now_playing_song = now_playing_entry.song
    
    upcoming_entries = db.query(PlaylistEntry).filter(
        PlaylistEntry.play_order > now_playing_entry.play_order
    ).order_by(PlaylistEntry.play_order).limit(5).all()

    # If not enough upcoming, wrap around
    if len(upcoming_entries) < 5:
        remaining_limit = 5 - len(upcoming_entries)
        wrap_around_entries = db.query(PlaylistEntry).order_by(PlaylistEntry.play_order).limit(remaining_limit).all()
        upcoming_entries.extend(wrap_around_entries)

    upcoming_songs = [entry.song for entry in upcoming_entries]

    return PlaylistResponse(now_playing=now_playing_song, upcoming=upcoming_songs)

@app.get("/playlist.txt", response_class=PlainTextResponse)
def get_playlist_text(db: Session = Depends(get_db)):
    playlist_entries = db.query(PlaylistEntry).order_by(PlaylistEntry.play_order).all()
    if not playlist_entries:
        generate_new_playlist(db)
        playlist_entries = db.query(PlaylistEntry).order_by(PlaylistEntry.play_order).all()

    # Get all song file paths from the playlist
    song_urls = [entry.song.file_path for entry in playlist_entries]
    
    # Return as a plain text response with each URL on a new line
    return "\n".join(song_urls)

@app.post("/next_song", response_model=SongResponse)
def advance_to_next_song(db: Session = Depends(get_db)):
    """
    Internal endpoint for the streamer to advance to the next song.
    """
    current_playing = db.query(PlaylistEntry).filter(PlaylistEntry.is_playing == True).first()
    
    next_order = 0
    if current_playing:
        current_playing.is_playing = False
        current_playing.played_at = datetime.utcnow()
        next_order = current_playing.play_order + 1

    next_song_entry = db.query(PlaylistEntry).filter(PlaylistEntry.play_order == next_order).first()

    if not next_song_entry:
        # Reached end of playlist, regenerate
        generate_new_playlist(db)
        next_song_entry = db.query(PlaylistEntry).filter(PlaylistEntry.play_order == 0).first()

    if not next_song_entry:
         raise HTTPException(status_code=404, detail="Could not determine next song.")

    next_song_entry.is_playing = True
    db.commit()
    
    return SongResponse.from_orm(next_song_entry.song)

@app.post("/skip", response_model=SongResponse)
def skip_song(db: Session = Depends(get_db)):
    """Skip the current song and move to the next one."""
    
    # Generate a new playlist, which effectively skips the current song
    new_playlist = generate_new_playlist(db)
    
    # Find the new "now_playing" song
    now_playing_entry = db.query(PlaylistEntry).filter(PlaylistEntry.play_order == 0).first()

    if not now_playing_entry:
        raise HTTPException(status_code=404, detail="Playlist is empty.")

    # Signal the streamer to restart to pick up the new song
    try:
        subprocess.run(["supervisorctl", "restart", "streamer"], check=True)
        print("Supervisor: Restart signal sent to streamer.")
    except Exception as e:
        print(f"Error restarting streamer: {e}")
        # This might fail if not running in the container, but we don't want to crash
        pass

    return SongResponse.from_orm(now_playing_entry.song)

@app.post("/play-next/{song_id}", response_model=SongResponse)
def queue_specific_song(song_id: int, db: Session = Depends(get_db)):
    """
    Queue a specific song to be played next.
    """
    current_playing = db.query(PlaylistEntry).filter(PlaylistEntry.is_playing == True).first()
    if not current_playing:
        raise HTTPException(status_code=404, detail="No song currently playing.")

    target_song_entry = db.query(PlaylistEntry).filter(PlaylistEntry.song_id == song_id).first()
    if not target_song_entry:
        raise HTTPException(status_code=404, detail="Song not found in playlist.")

    # Swap play order
    current_order = current_playing.play_order
    next_order = current_order + 1
    
    entry_at_next_spot = db.query(PlaylistEntry).filter(PlaylistEntry.play_order == next_order).first()
    
    if entry_at_next_spot:
        entry_at_next_spot.play_order = target_song_entry.play_order
    
    target_song_entry.play_order = next_order
    
    db.commit()
    
    return SongResponse.from_orm(target_song_entry.song) 