#!/bin/bash

# Bernie Radio Continuous Stream Management Script
# Provides easy commands to manage the streaming system

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Function to display usage
usage() {
    echo "Bernie Radio Stream Manager"
    echo "=========================="
    echo ""
    echo "Usage: $0 {start|stop|restart|status|logs|build|update}"
    echo ""
    echo "Commands:"
    echo "  start    - Start the streaming services"
    echo "  stop     - Stop all services"
    echo "  restart  - Restart all services"
    echo "  status   - Show status of all services"
    echo "  logs     - Show live logs from all services"
    echo "  build    - Rebuild the Docker image"
    echo "  update   - Update playlist and restart liquidsoap only"
    echo ""
}

# Function to check if services are running
check_running() {
    if docker-compose ps | grep -q "Up"; then
        return 0
    else
        return 1
    fi
}

# Start services
start_services() {
    echo -e "${BLUE}Starting Bernie Radio Continuous Stream...${NC}"
    
    if check_running; then
        echo -e "${YELLOW}Services are already running${NC}"
        return 1
    fi
    
    docker-compose up -d
    
    echo -e "${GREEN}✓ Services started${NC}"
    echo ""
    echo "Stream URL: http://localhost:8000/stream"
    echo "API: http://localhost:8001"
    echo ""
    echo "Run '$0 logs' to view service logs"
}

# Stop services
stop_services() {
    echo -e "${BLUE}Stopping Bernie Radio services...${NC}"
    
    docker-compose down
    
    echo -e "${GREEN}✓ Services stopped${NC}"
}

# Restart services
restart_services() {
    echo -e "${BLUE}Restarting Bernie Radio services...${NC}"
    
    docker-compose restart
    
    echo -e "${GREEN}✓ Services restarted${NC}"
}

# Show status
show_status() {
    echo -e "${BLUE}Bernie Radio Service Status${NC}"
    echo "=========================="
    echo ""
    
    # Check if containers are running
    if check_running; then
        echo -e "Overall Status: ${GREEN}✓ Running${NC}"
        echo ""
        docker-compose ps
        
        echo ""
        echo -e "${BLUE}Service Health:${NC}"
        
        # Check Icecast
        if nc -z localhost 8000 2>/dev/null; then
            echo -e "  Icecast: ${GREEN}✓ Accessible${NC} (port 8000)"
        else
            echo -e "  Icecast: ${RED}✗ Not accessible${NC}"
        fi
        
        # Check API
        if nc -z localhost 8001 2>/dev/null; then
            echo -e "  API: ${GREEN}✓ Accessible${NC} (port 8001)"
        else
            echo -e "  API: ${RED}✗ Not accessible${NC}"
        fi
        
        # Check stream
        if timeout 2s curl -s http://localhost:8000/stream -o /dev/null; then
            echo -e "  Stream: ${GREEN}✓ Broadcasting${NC}"
        else
            echo -e "  Stream: ${RED}✗ Not broadcasting${NC}"
        fi
        
        # Show current listeners
        listeners=$(curl -s http://localhost:8000/status-json.xsl | grep -o '"listeners":[0-9]*' | cut -d: -f2 || echo "0")
        echo -e "  Listeners: ${BLUE}${listeners}${NC}"
        
    else
        echo -e "Overall Status: ${RED}✗ Not running${NC}"
        echo ""
        echo "Run '$0 start' to start the services"
    fi
}

# Show logs
show_logs() {
    echo -e "${BLUE}Showing live logs (Ctrl+C to exit)...${NC}"
    echo ""
    docker-compose logs -f
}

# Build/rebuild image
build_image() {
    echo -e "${BLUE}Building Bernie Radio Docker image...${NC}"
    
    docker-compose build --no-cache
    
    echo -e "${GREEN}✓ Image built successfully${NC}"
    echo "Run '$0 start' to start with the new image"
}

# Update playlist only (useful for adding new songs without full restart)
update_playlist() {
    echo -e "${BLUE}Updating playlist...${NC}"
    
    if ! check_running; then
        echo -e "${RED}Services are not running${NC}"
        return 1
    fi
    
    # Restart only liquidsoap inside the container
    docker exec bernie-radio supervisorctl restart liquidsoap
    
    echo -e "${GREEN}✓ Liquidsoap restarted with updated playlist${NC}"
}

# Main script logic
case "$1" in
    start)
        start_services
        ;;
    stop)
        stop_services
        ;;
    restart)
        restart_services
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs
        ;;
    build)
        build_image
        ;;
    update)
        update_playlist
        ;;
    *)
        usage
        exit 1
        ;;
esac

exit 0