#!/bin/bash

# Test script for Bernie Radio Continuous Streaming
# This script helps verify that the stream runs continuously without interruption

echo "Bernie Radio Continuous Stream Test"
echo "==================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check if a service is running
check_service() {
    local service=$1
    local port=$2
    
    echo -n "Checking $service on port $port... "
    
    if nc -z localhost $port 2>/dev/null; then
        echo -e "${GREEN}✓ Running${NC}"
        return 0
    else
        echo -e "${RED}✗ Not running${NC}"
        return 1
    fi
}

# Function to test stream connectivity
test_stream() {
    echo -n "Testing stream connectivity... "
    
    # Try to download a few seconds of the stream
    if timeout 5s curl -s http://localhost:8000/stream -o /dev/null; then
        echo -e "${GREEN}✓ Stream is accessible${NC}"
        return 0
    else
        echo -e "${RED}✗ Stream not accessible${NC}"
        return 1
    fi
}

# Function to check API playlist
check_playlist() {
    echo -n "Checking API playlist endpoint... "
    
    response=$(curl -s http://localhost:8001/playlist.txt)
    line_count=$(echo "$response" | wc -l)
    
    if [ $line_count -gt 0 ]; then
        echo -e "${GREEN}✓ Playlist has $line_count songs${NC}"
        return 0
    else
        echo -e "${RED}✗ Playlist is empty${NC}"
        return 1
    fi
}

# Function to monitor stream for continuity
monitor_stream() {
    local duration=$1
    echo ""
    echo -e "${YELLOW}Monitoring stream for $duration seconds...${NC}"
    echo "This will check if the stream remains continuous without interruption."
    echo ""
    
    # Start recording stream in background
    timeout ${duration}s curl -s http://localhost:8000/stream -o test_stream.mp3 &
    curl_pid=$!
    
    # Monitor the file size growth
    prev_size=0
    interruptions=0
    checks=0
    
    while kill -0 $curl_pid 2>/dev/null; do
        sleep 2
        if [ -f test_stream.mp3 ]; then
            current_size=$(stat -f%z test_stream.mp3 2>/dev/null || stat -c%s test_stream.mp3 2>/dev/null || echo 0)
            
            if [ $current_size -eq $prev_size ] && [ $prev_size -gt 0 ]; then
                interruptions=$((interruptions + 1))
                echo -e "${RED}⚠ Stream may have stopped (no data received)${NC}"
            else
                growth=$((current_size - prev_size))
                echo -e "Stream data received: ${GREEN}+${growth} bytes${NC} (Total: $current_size bytes)"
            fi
            
            prev_size=$current_size
            checks=$((checks + 1))
        fi
    done
    
    # Clean up
    rm -f test_stream.mp3
    
    echo ""
    if [ $interruptions -eq 0 ]; then
        echo -e "${GREEN}✓ Stream ran continuously for $duration seconds without interruption!${NC}"
        return 0
    else
        echo -e "${YELLOW}⚠ Stream had $interruptions potential interruptions out of $checks checks${NC}"
        return 1
    fi
}

# Main test sequence
echo "1. Checking Services"
echo "-------------------"
services_ok=true

check_service "Icecast" 8000 || services_ok=false
check_service "API" 8001 || services_ok=false

if [ "$services_ok" = false ]; then
    echo ""
    echo -e "${RED}Some services are not running. Please start the containers:${NC}"
    echo "  docker-compose up -d"
    exit 1
fi

echo ""
echo "2. Testing Endpoints"
echo "-------------------"
test_stream
check_playlist

echo ""
echo "3. Continuous Stream Test"
echo "------------------------"
echo "Would you like to monitor the stream for continuity? (y/n)"
read -r response

if [[ "$response" =~ ^[Yy]$ ]]; then
    echo "How many seconds would you like to monitor? (default: 30)"
    read -r duration
    duration=${duration:-30}
    
    monitor_stream $duration
fi

echo ""
echo "4. Check Logs"
echo "-------------"
echo "To view liquidsoap logs for any issues:"
echo "  docker exec -it bernie-radio tail -f /var/log/supervisor/liquidsoap.log"
echo ""
echo "To view all service logs:"
echo "  docker-compose logs -f"

echo ""
echo -e "${GREEN}Test complete!${NC}"