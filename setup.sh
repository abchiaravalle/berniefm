#!/bin/bash

# BC Radio Livestream Setup Script
# This script automates the setup of AzuraCast and music download

set -e

echo "🎵 BC Radio Livestream Setup"
echo "================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is installed
check_docker() {
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    print_success "Docker and Docker Compose are installed"
}

# Check if Python is installed
check_python() {
    if ! command -v python3 &> /dev/null; then
        print_error "Python 3 is not installed. Please install Python 3 first."
        exit 1
    fi
    
    print_success "Python 3 is installed"
}

# Download music files
download_music() {
    print_status "Downloading music files from S3..."
    
    if [ -d "music" ] && [ "$(ls -A music)" ]; then
        print_warning "Music directory already exists and is not empty."
        read -p "Do you want to re-download all music files? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_status "Skipping music download."
            return 0
        fi
    fi
    
    python3 download_music.py
    
    if [ $? -eq 0 ]; then
        print_success "Music files downloaded successfully"
    else
        print_error "Failed to download music files"
        exit 1
    fi
}

# Start AzuraCast
start_azuracast() {
    print_status "Starting AzuraCast container..."
    
    # Check if container is already running
    if docker-compose ps | grep -q "azuracast.*Up"; then
        print_warning "AzuraCast is already running"
        return 0
    fi
    
    docker-compose up -d
    
    if [ $? -eq 0 ]; then
        print_success "AzuraCast container started successfully"
    else
        print_error "Failed to start AzuraCast container"
        exit 1
    fi
}

# Wait for AzuraCast to be ready
wait_for_azuracast() {
    print_status "Waiting for AzuraCast to be ready..."
    
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s -f http://localhost >/dev/null 2>&1; then
            print_success "AzuraCast is ready!"
            return 0
        fi
        
        print_status "Attempt $attempt/$max_attempts - AzuraCast not ready yet, waiting..."
        sleep 10
        ((attempt++))
    done
    
    print_error "AzuraCast did not become ready within the expected time"
    print_warning "You may need to wait a bit longer and check manually at http://localhost"
}

# Display final instructions
show_final_instructions() {
    echo ""
    echo "🎉 Setup Complete!"
    echo "=================="
    echo ""
    echo "Next steps:"
    echo "1. Open your browser and go to: http://localhost"
    echo "2. Create your admin account in AzuraCast"
    echo "3. Follow the configuration steps in README.md"
    echo ""
    echo "Key configuration points:"
    echo "• Create a station named 'BC Radio'"
    echo "• Set up a mount point at '/listen' with MP3 format"
    echo "• Import music from the media library"
    echo "• Create playlists and enable AutoDJ"
    echo "• Test the stream at: http://localhost:8000/listen"
    echo ""
    echo "Then open index-livestream.html to enjoy your BC Radio stream!"
    echo ""
    echo "📖 For detailed instructions, see README.md"
}

# Main execution
main() {
    print_status "Starting BC Radio Livestream setup..."
    
    # Check prerequisites
    check_docker
    check_python
    
    # Download music
    download_music
    
    # Start services
    start_azuracast
    
    # Wait for readiness
    wait_for_azuracast
    
    # Show final instructions
    show_final_instructions
}

# Run main function
main "$@"