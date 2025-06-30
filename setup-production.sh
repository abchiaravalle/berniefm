#!/bin/bash

# BC Radio Production Setup - Master Script
# One-command setup for complete production-ready radio station

set -e

echo "🎵 BC Radio Production Setup - Master Script"
echo "============================================="
echo ""
echo "This script will set up a complete production-ready radio station including:"
echo "• DigitalOcean infrastructure"
echo "• Professional audio processing"
echo "• Legal compliance framework"
echo "• Monitoring and analytics"
echo "• SSL certificates and security"
echo "• Backup and recovery systems"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

print_header() {
    echo ""
    echo -e "${PURPLE}================================${NC}"
    echo -e "${PURPLE} $1${NC}"
    echo -e "${PURPLE}================================${NC}"
    echo ""
}

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

print_step() {
    echo -e "${CYAN}[STEP]${NC} $1"
}

# Configuration variables
DOMAIN=""
EMAIL=""
SETUP_TYPE=""
SKIP_PROMPTS=false
DRY_RUN=false

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --domain)
                DOMAIN="$2"
                shift 2
                ;;
            --email)
                EMAIL="$2"
                shift 2
                ;;
            --type)
                SETUP_TYPE="$2"
                shift 2
                ;;
            --skip-prompts)
                SKIP_PROMPTS=true
                shift
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --help)
                show_help
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

show_help() {
    echo "BC Radio Production Setup"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --domain DOMAIN     Your domain name (e.g., bcradio.com)"
    echo "  --email EMAIL       Your email for SSL certificates"
    echo "  --type TYPE         Setup type: digitalocean, local, or custom"
    echo "  --skip-prompts      Skip interactive prompts (use defaults)"
    echo "  --dry-run          Show what would be done without executing"
    echo "  --help             Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 --domain bcradio.com --email admin@bcradio.com --type digitalocean"
    echo "  $0 --type local --skip-prompts"
    echo ""
}

# Interactive configuration
configure_setup() {
    if [[ "$SKIP_PROMPTS" == "true" ]]; then
        DOMAIN=${DOMAIN:-"bcradio.local"}
        EMAIL=${EMAIL:-"admin@bcradio.local"}
        SETUP_TYPE=${SETUP_TYPE:-"local"}
        return
    fi

    print_header "Configuration"
    
    echo "Let's configure your BC Radio production setup:"
    echo ""
    
    # Domain configuration
    if [[ -z "$DOMAIN" ]]; then
        echo -n "Enter your domain name (e.g., bcradio.com): "
        read DOMAIN
        
        if [[ -z "$DOMAIN" ]]; then
            DOMAIN="bcradio.local"
            print_warning "Using default domain: $DOMAIN"
        fi
    fi
    
    # Email configuration
    if [[ -z "$EMAIL" ]]; then
        echo -n "Enter your email for SSL certificates: "
        read EMAIL
        
        if [[ -z "$EMAIL" ]]; then
            EMAIL="admin@$DOMAIN"
            print_warning "Using default email: $EMAIL"
        fi
    fi
    
    # Setup type
    if [[ -z "$SETUP_TYPE" ]]; then
        echo ""
        echo "Choose setup type:"
        echo "1) DigitalOcean (Recommended - Full cloud deployment)"
        echo "2) Local Development (Testing and development)"
        echo "3) Custom Server (Your own server)"
        echo ""
        echo -n "Enter choice (1-3): "
        read choice
        
        case $choice in
            1) SETUP_TYPE="digitalocean" ;;
            2) SETUP_TYPE="local" ;;
            3) SETUP_TYPE="custom" ;;
            *) 
                SETUP_TYPE="local"
                print_warning "Invalid choice, using local setup"
                ;;
        esac
    fi
    
    echo ""
    print_success "Configuration complete:"
    echo "  Domain: $DOMAIN"
    echo "  Email: $EMAIL"
    echo "  Setup Type: $SETUP_TYPE"
    echo ""
    
    if [[ "$DRY_RUN" == "false" ]]; then
        echo -n "Continue with setup? (y/N): "
        read confirm
        if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
            echo "Setup cancelled."
            exit 0
        fi
    fi
}

# Check prerequisites
check_prerequisites() {
    print_header "Prerequisites Check"
    
    local missing_deps=()
    
    # Check if running as root
    if [[ $EUID -ne 0 ]]; then
        print_error "This script must be run as root"
        echo "Please run: sudo $0"
        exit 1
    fi
    
    # Check required commands
    local required_commands=("docker" "docker-compose" "git" "curl" "python3")
    
    for cmd in "${required_commands[@]}"; do
        if ! command -v "$cmd" &> /dev/null; then
            missing_deps+=("$cmd")
        else
            print_success "$cmd is installed"
        fi
    done
    
    # Install missing dependencies
    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        print_warning "Installing missing dependencies: ${missing_deps[*]}"
        
        if [[ "$DRY_RUN" == "false" ]]; then
            apt update
            apt install -y docker.io docker-compose git curl python3 python3-pip
            
            # Start Docker service
            systemctl start docker
            systemctl enable docker
        fi
    fi
    
    print_success "Prerequisites check complete"
}

# Setup infrastructure based on type
setup_infrastructure() {
    print_header "Infrastructure Setup"
    
    case $SETUP_TYPE in
        "digitalocean")
            setup_digitalocean_infrastructure
            ;;
        "local")
            setup_local_infrastructure
            ;;
        "custom")
            setup_custom_infrastructure
            ;;
        *)
            print_error "Unknown setup type: $SETUP_TYPE"
            exit 1
            ;;
    esac
}

setup_digitalocean_infrastructure() {
    print_step "Setting up DigitalOcean infrastructure..."
    
    if [[ "$DRY_RUN" == "false" ]]; then
        if [[ -f "setup-digitalocean.sh" ]]; then
            bash setup-digitalocean.sh --domain "$DOMAIN" --email "$EMAIL" --skip-prompts
        else
            print_warning "setup-digitalocean.sh not found, skipping cloud setup"
        fi
    else
        echo "Would run: bash setup-digitalocean.sh --domain $DOMAIN --email $EMAIL --skip-prompts"
    fi
}

setup_local_infrastructure() {
    print_step "Setting up local development infrastructure..."
    
    if [[ "$DRY_RUN" == "false" ]]; then
        # Create necessary directories
        mkdir -p {music,backups,logs,monitoring}
        
        # Setup basic docker-compose if not exists
        if [[ ! -f "docker-compose.yml" ]]; then
            print_status "Creating basic docker-compose.yml..."
            cat > docker-compose.yml << EOF
version: '3.8'

services:
  azuracast:
    image: azuracast/azuracast:latest
    ports:
      - "8080:80"
      - "8000-8999:8000-8999"
    volumes:
      - ./music:/var/azuracast/stations/1/media
      - azuracast_data:/var/azuracast
    environment:
      - AZURACAST_DC_REVISION=latest
    restart: unless-stopped

volumes:
  azuracast_data:
EOF
        fi
    else
        echo "Would create local infrastructure setup"
    fi
}

setup_custom_infrastructure() {
    print_step "Setting up custom server infrastructure..."
    
    print_status "Custom server setup requires manual configuration"
    print_status "Please ensure your server has:"
    echo "  • Docker and Docker Compose installed"
    echo "  • Ports 80, 443, 8000-8999 open"
    echo "  • DNS pointing to this server"
    echo "  • SSL certificate configured"
}

# Download and setup music library
setup_music_library() {
    print_header "Music Library Setup"
    
    print_step "Setting up Bernie Chiaravalle music library..."
    
    if [[ "$DRY_RUN" == "false" ]]; then
        if [[ -f "download_music.py" ]]; then
            python3 download_music.py
        else
            print_warning "download_music.py not found, skipping music download"
            print_status "You'll need to manually add music to the ./music directory"
        fi
    else
        echo "Would download music library using download_music.py"
    fi
}

# Setup audio processing
setup_audio_processing() {
    print_header "Audio Processing Setup"
    
    print_step "Installing professional audio processing..."
    
    if [[ "$DRY_RUN" == "false" ]]; then
        if [[ -f "enhance-audio.sh" ]]; then
            bash enhance-audio.sh
        else
            print_warning "enhance-audio.sh not found, skipping audio enhancement"
        fi
    else
        echo "Would run: bash enhance-audio.sh"
    fi
}

# Setup legal compliance
setup_legal_compliance() {
    print_header "Legal Compliance Setup"
    
    print_step "Setting up legal compliance framework..."
    
    if [[ "$DRY_RUN" == "false" ]]; then
        if [[ -f "legal-compliance.py" ]]; then
            python3 legal-compliance.py all "$DOMAIN"
            
            # Start broadcast logging
            print_status "Starting broadcast logging..."
            if [[ -f "broadcast_logger.py" ]]; then
                nohup python3 broadcast_logger.py > logs/broadcast.log 2>&1 &
                echo $! > broadcast_logger.pid
                print_success "Broadcast logger started (PID: $(cat broadcast_logger.pid))"
            fi
        else
            print_warning "legal-compliance.py not found, skipping legal setup"
        fi
    else
        echo "Would run: python3 legal-compliance.py all $DOMAIN"
    fi
    
    print_warning "IMPORTANT: Review music licensing requirements!"
    echo "  • Check generated files: privacy_policy.md, terms_of_service.md, dmca_policy.md"
    echo "  • Apply for music licenses: ASCAP, BMI, SESAC, SoundExchange"
    echo "  • Estimated cost: \$1,000-5,000/year depending on audience size"
}

# Setup monitoring
setup_monitoring() {
    print_header "Monitoring Setup"
    
    print_step "Installing production monitoring stack..."
    
    if [[ "$DRY_RUN" == "false" ]]; then
        if [[ -f "setup-monitoring.sh" ]]; then
            bash setup-monitoring.sh
        else
            print_warning "setup-monitoring.sh not found, skipping monitoring setup"
        fi
    else
        echo "Would run: bash setup-monitoring.sh"
    fi
}

# Setup web interface
setup_web_interface() {
    print_header "Web Interface Setup"
    
    print_step "Configuring BC Radio web interface..."
    
    if [[ "$DRY_RUN" == "false" ]]; then
        # Build the livestream interface
        if [[ -f "build.py" ]]; then
            python3 build.py --domain "$DOMAIN" --type production
        fi
        
        # Setup Caddy reverse proxy
        if [[ -f "setup-caddy.sh" ]]; then
            bash setup-caddy.sh --domain "$DOMAIN" --email "$EMAIL"
        fi
    else
        echo "Would run: python3 build.py --domain $DOMAIN --type production"
        echo "Would run: bash setup-caddy.sh --domain $DOMAIN --email $EMAIL"
    fi
}

# Setup backup system
setup_backup_system() {
    print_header "Backup System Setup"
    
    print_step "Configuring automated backups..."
    
    if [[ "$DRY_RUN" == "false" ]]; then
        # Create backup script if not exists
        if [[ ! -f "backup_station.sh" ]]; then
            cat > backup_station.sh << 'EOF'
#!/bin/bash
# BC Radio Automated Backup

BACKUP_DIR="./backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "Creating BC Radio backup..."

# Backup AzuraCast data
docker-compose exec -T azuracast azuracast_cli backup --path=/tmp/backup.zip
docker cp $(docker-compose ps -q azuracast):/tmp/backup.zip "$BACKUP_DIR/azuracast_backup.zip"

# Backup configurations
cp -r Caddyfile build.config.json docker-compose.yml "$BACKUP_DIR/" 2>/dev/null || true

# Backup logs
cp -r logs "$BACKUP_DIR/" 2>/dev/null || true

echo "Backup complete: $BACKUP_DIR"
EOF
            chmod +x backup_station.sh
        fi
        
        # Setup daily backup cron job
        (crontab -l 2>/dev/null; echo "0 2 * * * cd $(pwd) && ./backup_station.sh") | crontab -
        
        print_success "Daily backup scheduled at 2 AM"
    else
        echo "Would create backup system and schedule daily backups"
    fi
}

# Setup SSL certificates
setup_ssl() {
    print_header "SSL Certificate Setup"
    
    if [[ "$SETUP_TYPE" == "local" ]]; then
        print_status "Skipping SSL setup for local development"
        return
    fi
    
    print_step "Setting up SSL certificates..."
    
    if [[ "$DRY_RUN" == "false" ]]; then
        # SSL setup is handled by Caddy automatically
        print_status "SSL certificates will be automatically managed by Caddy"
        print_status "Certificates for $DOMAIN will be obtained from Let's Encrypt"
    else
        echo "Would setup SSL certificates for $DOMAIN"
    fi
}

# Start all services
start_services() {
    print_header "Starting Services"
    
    print_step "Starting all BC Radio services..."
    
    if [[ "$DRY_RUN" == "false" ]]; then
        # Start main application
        docker-compose up -d
        
        # Start monitoring if available
        if [[ -f "start_monitoring.sh" ]]; then
            bash start_monitoring.sh
        fi
        
        # Wait for services to be ready
        print_status "Waiting for services to start..."
        sleep 30
        
        # Check service health
        check_service_health
    else
        echo "Would start all services using docker-compose up -d"
    fi
}

# Check service health
check_service_health() {
    print_step "Checking service health..."
    
    local services_ok=true
    
    # Check AzuraCast
    if curl -s "http://localhost:8080" > /dev/null; then
        print_success "AzuraCast is running"
    else
        print_error "AzuraCast is not responding"
        services_ok=false
    fi
    
    # Check stream
    if curl -s "http://localhost:8000/listen" > /dev/null; then
        print_success "Stream is available"
    else
        print_warning "Stream may not be ready yet"
    fi
    
    # Check monitoring if available
    if curl -s "http://localhost:3000" > /dev/null; then
        print_success "Monitoring dashboard is available"
    fi
    
    if [[ "$services_ok" == "true" ]]; then
        print_success "All core services are healthy"
    else
        print_warning "Some services may need attention"
    fi
}

# Generate final report
generate_final_report() {
    print_header "Setup Complete!"
    
    cat << EOF

🎉 BC Radio Production Setup Complete!
=====================================

Your professional radio station is now ready!

📡 Access URLs:
EOF

    if [[ "$SETUP_TYPE" == "local" ]]; then
        cat << EOF
  • Radio Station: http://localhost
  • AzuraCast Admin: http://localhost:8080
  • Stream URL: http://localhost:8000/listen
EOF
    else
        cat << EOF
  • Radio Station: https://$DOMAIN
  • AzuraCast Admin: https://$DOMAIN/admin
  • Stream URL: https://stream.$DOMAIN/listen
EOF
    fi

    if [[ -f "start_monitoring.sh" ]]; then
        cat << EOF
  • Grafana Dashboard: http://localhost:3000 (admin/bcradio123)
  • Prometheus: http://localhost:9090
EOF
    fi

    cat << EOF

🛠️  Management Commands:
  • Check status: docker-compose ps
  • View logs: docker-compose logs -f
  • Restart services: docker-compose restart
  • Create backup: ./backup_station.sh
EOF

    if [[ -f "do-manage.py" ]]; then
        echo "  • DigitalOcean management: python3 do-manage.py status"
    fi

    cat << EOF

📋 Important Next Steps:
  1. 🎵 Review audio quality: python3 audio_report.py
  2. ⚖️  Apply for music licenses (CRITICAL for legal operation)
  3. 📧 Configure email alerts in monitoring/alertmanager/alertmanager.yml
  4. 🔒 Review legal documents in privacy_policy.md, terms_of_service.md
  5. 📊 Check monitoring dashboard for system health

⚠️  CRITICAL: Music Licensing Required!
  • Visit: python3 legal-compliance.py licensing
  • Estimated cost: \$1,000-5,000/year
  • Required for legal operation

🎵 Your BC Radio station is now production-ready!
   Enjoy streaming Bernie Chiaravalle's music professionally!

EOF

    # Save configuration for future reference
    cat > bc-radio-config.json << EOF
{
    "domain": "$DOMAIN",
    "email": "$EMAIL",
    "setup_type": "$SETUP_TYPE",
    "setup_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "version": "1.0.0"
}
EOF

    print_success "Configuration saved to bc-radio-config.json"
}

# Cleanup on error
cleanup_on_error() {
    print_error "Setup failed! Cleaning up..."
    
    # Stop any running services
    docker-compose down 2>/dev/null || true
    
    # Kill background processes
    if [[ -f broadcast_logger.pid ]]; then
        kill $(cat broadcast_logger.pid) 2>/dev/null || true
        rm broadcast_logger.pid
    fi
    
    print_status "Cleanup complete. Check logs for error details."
    exit 1
}

# Main execution
main() {
    # Set error handler
    trap cleanup_on_error ERR
    
    # Parse command line arguments
    parse_args "$@"
    
    # Show banner
    print_header "BC Radio Production Setup"
    echo "Complete production-ready radio station setup"
    echo "Version: 1.0.0"
    echo ""
    
    if [[ "$DRY_RUN" == "true" ]]; then
        print_warning "DRY RUN MODE - No changes will be made"
        echo ""
    fi
    
    # Run setup steps
    configure_setup
    check_prerequisites
    setup_infrastructure
    setup_music_library
    setup_audio_processing
    setup_legal_compliance
    setup_monitoring
    setup_web_interface
    setup_backup_system
    setup_ssl
    start_services
    generate_final_report
    
    print_success "BC Radio production setup completed successfully!"
}

# Run main function with all arguments
main "$@"