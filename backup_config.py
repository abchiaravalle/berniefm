#!/usr/bin/env python3
"""
BC Radio Configuration Backup Tool
Creates backups of AzuraCast configuration and playlists.
"""

import subprocess
import json
import datetime
import zipfile
from pathlib import Path
import shutil

def run_command(cmd):
    """Run a command and return result"""
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=60)
        return result.returncode == 0, result.stdout, result.stderr
    except Exception as e:
        return False, "", str(e)

def create_backup():
    """Create a backup of AzuraCast configuration"""
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = Path(f"backup_{timestamp}")
    backup_dir.mkdir(exist_ok=True)
    
    print(f"📦 Creating backup in: {backup_dir}")
    
    # Backup Docker volumes
    print("💾 Backing up Docker volumes...")
    
    volumes_to_backup = [
        'azuracast_db',
        'azuracast_station_data',
        'azuracast_backups'
    ]
    
    for volume in volumes_to_backup:
        print(f"   Backing up {volume}...")
        cmd = f"docker run --rm -v {volume}:/data -v $(pwd)/{backup_dir}:/backup alpine tar czf /backup/{volume}.tar.gz -C /data ."
        success, stdout, stderr = run_command(cmd)
        if success:
            print(f"   ✅ {volume} backed up")
        else:
            print(f"   ❌ Failed to backup {volume}: {stderr}")
    
    # Backup music directory structure (not files, just structure)
    print("🎵 Backing up music directory structure...")
    music_dir = Path("music")
    if music_dir.exists():
        structure_file = backup_dir / "music_structure.txt"
        with open(structure_file, 'w') as f:
            for mp3_file in music_dir.rglob("*.mp3"):
                f.write(f"{mp3_file}\n")
        print(f"   ✅ Music structure saved to {structure_file}")
    
    # Backup configuration files
    print("⚙️  Backing up configuration files...")
    config_files = [
        'docker-compose.yml',
        'index-livestream.html',
        'README.md',
        'AZURACAST_CONFIGURATION.md'
    ]
    
    for config_file in config_files:
        if Path(config_file).exists():
            shutil.copy2(config_file, backup_dir)
            print(f"   ✅ {config_file} backed up")
    
    # Create zip archive
    zip_file = Path(f"bc_radio_backup_{timestamp}.zip")
    print(f"🗜️  Creating zip archive: {zip_file}")
    
    with zipfile.ZipFile(zip_file, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for file_path in backup_dir.rglob("*"):
            if file_path.is_file():
                zipf.write(file_path, file_path.relative_to(backup_dir))
    
    # Cleanup temporary directory
    shutil.rmtree(backup_dir)
    
    print(f"✅ Backup completed: {zip_file}")
    print(f"📊 Backup size: {zip_file.stat().st_size / (1024*1024):.1f} MB")
    
    return zip_file

def restore_backup(backup_file):
    """Restore from a backup file"""
    backup_path = Path(backup_file)
    if not backup_path.exists():
        print(f"❌ Backup file not found: {backup_file}")
        return False
    
    print(f"📦 Restoring from: {backup_file}")
    
    # Extract backup
    extract_dir = Path("restore_temp")
    extract_dir.mkdir(exist_ok=True)
    
    with zipfile.ZipFile(backup_path, 'r') as zipf:
        zipf.extractall(extract_dir)
    
    # Restore Docker volumes
    print("💾 Restoring Docker volumes...")
    
    for tar_file in extract_dir.glob("*.tar.gz"):
        volume_name = tar_file.stem.replace('.tar', '')
        print(f"   Restoring {volume_name}...")
        
        cmd = f"docker run --rm -v {volume_name}:/data -v $(pwd)/{extract_dir}:/backup alpine tar xzf /backup/{tar_file.name} -C /data"
        success, stdout, stderr = run_command(cmd)
        if success:
            print(f"   ✅ {volume_name} restored")
        else:
            print(f"   ❌ Failed to restore {volume_name}: {stderr}")
    
    # Restore configuration files
    print("⚙️  Restoring configuration files...")
    for config_file in extract_dir.glob("*.yml"):
        shutil.copy2(config_file, ".")
        print(f"   ✅ {config_file.name} restored")
    
    # Cleanup
    shutil.rmtree(extract_dir)
    
    print("✅ Restore completed")
    print("🔄 Restart AzuraCast to apply changes: docker-compose restart")
    
    return True

def list_backups():
    """List available backup files"""
    backup_files = list(Path(".").glob("bc_radio_backup_*.zip"))
    
    if not backup_files:
        print("📁 No backup files found")
        return
    
    print("📁 Available backups:")
    for backup_file in sorted(backup_files, reverse=True):
        size_mb = backup_file.stat().st_size / (1024*1024)
        mtime = datetime.datetime.fromtimestamp(backup_file.stat().st_mtime)
        print(f"   {backup_file.name} ({size_mb:.1f} MB, {mtime.strftime('%Y-%m-%d %H:%M')})")

def main():
    """Main backup tool"""
    import sys
    
    if len(sys.argv) < 2:
        print("BC Radio Configuration Backup Tool")
        print("Usage:")
        print("  python3 backup_config.py create    - Create a new backup")
        print("  python3 backup_config.py restore <file> - Restore from backup")
        print("  python3 backup_config.py list      - List available backups")
        return
    
    command = sys.argv[1]
    
    if command == "create":
        create_backup()
    elif command == "restore":
        if len(sys.argv) < 3:
            print("❌ Please specify backup file to restore")
            list_backups()
        else:
            restore_backup(sys.argv[2])
    elif command == "list":
        list_backups()
    else:
        print(f"❌ Unknown command: {command}")

if __name__ == "__main__":
    main()