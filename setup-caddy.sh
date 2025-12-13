#!/bin/bash

# BC Radio Caddy Setup Script
# Sets up Caddy reverse proxy for BC Radio with automatic HTTPS

set -e

echo "🌐 BC Radio Caddy Setup"
echo "======================="
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

# Check if running as root
check_root() {
    if [[ $EUID -eq 0 ]]; then
        print_warning "Running as root. This is recommended for system-wide Caddy installation."
    else
        print_warning "Not running as root. You may need sudo privileges for some operations."
    fi
}

# Install Caddy
install_caddy() {
    print_status "Installing Caddy..."
    
    # Check if Caddy is already installed
    if command -v caddy &> /dev/null; then
        print_success "Caddy is already installed"
        caddy version
        return 0
    fi
    
    # Detect OS and install accordingly
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Ubuntu/Debian
        if command -v apt &> /dev/null; then
            print_status "Installing Caddy on Ubuntu/Debian..."
            sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
            curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
            curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
            sudo apt update
            sudo apt install caddy
        # CentOS/RHEL/Fedora
        elif command -v dnf &> /dev/null; then
            print_status "Installing Caddy on CentOS/RHEL/Fedora..."
            dnf install 'dnf-command(copr)'
            dnf copr enable @caddy/caddy
            dnf install caddy
        elif command -v yum &> /dev/null; then
            print_status "Installing Caddy on CentOS/RHEL (yum)..."
            yum install yum-plugin-copr
            yum copr enable @caddy/caddy
            yum install caddy
        else
            print_error "Unsupported Linux distribution"
            return 1
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command -v brew &> /dev/null; then
            print_status "Installing Caddy on macOS..."
            brew install caddy
        else
            print_error "Homebrew not found. Please install Homebrew first."
            return 1
        fi
    else
        print_error "Unsupported operating system: $OSTYPE"
        return 1
    fi
    
    if command -v caddy &> /dev/null; then
        print_success "Caddy installed successfully"
        caddy version
    else
        print_error "Caddy installation failed"
        return 1
    fi
}

# Configure domain
configure_domain() {
    print_status "Configuring domain..."
    
    # Get domain from user
    read -p "Enter your domain name (e.g., radio.example.com): " DOMAIN
    
    if [[ -z "$DOMAIN" ]]; then
        print_error "Domain name is required"
        return 1
    fi
    
    # Validate domain format (basic check)
    if [[ ! "$DOMAIN" =~ ^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$ ]]; then
        print_warning "Domain format might be invalid: $DOMAIN"
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            return 1
        fi
    fi
    
    # Update Caddyfile with domain
    if [[ -f "Caddyfile" ]]; then
        print_status "Updating Caddyfile with domain: $DOMAIN"
        sed -i.bak "s/yourdomain.com/$DOMAIN/g" Caddyfile
        print_success "Caddyfile updated"
    else
        print_error "Caddyfile not found"
        return 1
    fi
    
    echo "$DOMAIN" > .domain
    print_success "Domain configuration saved"
}

# Setup directories
setup_directories() {
    print_status "Setting up directories..."
    
    # Create web directory
    WEB_DIR="/var/www/bc-radio"
    if [[ ! -d "$WEB_DIR" ]]; then
        sudo mkdir -p "$WEB_DIR"
        print_success "Created web directory: $WEB_DIR"
    fi
    
    # Create log directory
    LOG_DIR="/var/log/caddy"
    if [[ ! -d "$LOG_DIR" ]]; then
        sudo mkdir -p "$LOG_DIR"
        print_success "Created log directory: $LOG_DIR"
    fi
    
    # Set permissions
    sudo chown -R caddy:caddy "$WEB_DIR" 2>/dev/null || true
    sudo chown -R caddy:caddy "$LOG_DIR" 2>/dev/null || true
    
    print_success "Directories configured"
}

# Install Caddyfile
install_caddyfile() {
    print_status "Installing Caddyfile..."
    
    # Backup existing Caddyfile
    if [[ -f "/etc/caddy/Caddyfile" ]]; then
        sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.backup
        print_status "Backed up existing Caddyfile"
    fi
    
    # Copy our Caddyfile
    if [[ -f "Caddyfile" ]]; then
        sudo cp Caddyfile /etc/caddy/Caddyfile
        print_success "Installed Caddyfile"
    else
        print_error "Caddyfile not found in current directory"
        return 1
    fi
    
    # Validate Caddyfile
    if sudo caddy validate --config /etc/caddy/Caddyfile; then
        print_success "Caddyfile validation passed"
    else
        print_error "Caddyfile validation failed"
        return 1
    fi
}

# Start Caddy service
start_caddy() {
    print_status "Starting Caddy service..."
    
    # Enable and start Caddy
    if systemctl is-active --quiet caddy; then
        print_status "Reloading Caddy configuration..."
        sudo systemctl reload caddy
    else
        print_status "Starting Caddy..."
        sudo systemctl enable caddy
        sudo systemctl start caddy
    fi
    
    # Check status
    if systemctl is-active --quiet caddy; then
        print_success "Caddy is running"
    else
        print_error "Failed to start Caddy"
        sudo systemctl status caddy
        return 1
    fi
}

# Check AzuraCast
check_azuracast() {
    print_status "Checking AzuraCast status..."
    
    # Check if AzuraCast is running
    if docker-compose ps | grep -q "azuracast.*Up"; then
        print_success "AzuraCast is running"
    else
        print_warning "AzuraCast is not running"
        read -p "Start AzuraCast now? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            docker-compose up -d
            sleep 10
        fi
    fi
    
    # Test local endpoints
    if curl -s -f http://localhost:80 >/dev/null; then
        print_success "AzuraCast web interface is accessible"
    else
        print_warning "AzuraCast web interface is not accessible"
    fi
    
    if curl -s -f http://localhost:8000/api/nowplaying >/dev/null; then
        print_success "AzuraCast API is accessible"
    else
        print_warning "AzuraCast API is not accessible"
    fi
}

# Test configuration
test_configuration() {
    print_status "Testing configuration..."
    
    if [[ -f ".domain" ]]; then
        DOMAIN=$(cat .domain)
        
        print_status "Testing domain: $DOMAIN"
        
        # Test HTTPS
        if curl -s -f "https://$DOMAIN" >/dev/null; then
            print_success "HTTPS is working"
        else
            print_warning "HTTPS test failed - this is normal during initial setup"
            print_status "SSL certificate will be automatically obtained on first request"
        fi
        
        # Test API endpoint
        if curl -s -f "https://$DOMAIN/api/nowplaying" >/dev/null; then
            print_success "API endpoint is working"
        else
            print_warning "API endpoint test failed"
        fi
        
    else
        print_warning "Domain not configured"
    fi
}

# Deploy static files
deploy_static() {
    print_status "Deploying static files..."
    
    # Check if dist directory exists
    if [[ -d "dist" ]]; then
        print_status "Deploying from dist directory..."
        sudo cp -r dist/* /var/www/bc-radio/
        print_success "Static files deployed"
    else
        print_warning "No dist directory found"
        print_status "Run 'python3 build.py' to build static files first"
    fi
}

# Show final instructions
show_instructions() {
    echo ""
    echo "🎉 Caddy Setup Complete!"
    echo "========================"
    echo ""
    
    if [[ -f ".domain" ]]; then
        DOMAIN=$(cat .domain)
        echo "🌐 Your BC Radio is available at: https://$DOMAIN"
        echo "🔧 Admin interface: https://$DOMAIN/admin"
        echo "📻 Stream URL: https://$DOMAIN/stream/listen"
        echo "🔌 API URL: https://$DOMAIN/api/nowplaying"
    else
        echo "🌐 Configure your domain and update Caddyfile"
    fi
    
    echo ""
    echo "📋 Next steps:"
    echo "1. Configure your DNS to point to this server"
    echo "2. Build and deploy static files: python3 build.py"
    echo "3. Configure AzuraCast following AZURACAST_CONFIGURATION.md"
    echo "4. Test your setup with: curl -I https://yourdomain.com"
    echo ""
    echo "🔧 Useful commands:"
    echo "• Check Caddy status: sudo systemctl status caddy"
    echo "• View Caddy logs: sudo journalctl -u caddy -f"
    echo "• Reload Caddy config: sudo systemctl reload caddy"
    echo "• Validate Caddyfile: sudo caddy validate --config /etc/caddy/Caddyfile"
}

# Main execution
main() {
    print_status "Starting BC Radio Caddy setup..."
    
    # Check prerequisites
    check_root
    
    # Install Caddy
    install_caddy
    
    # Configure domain
    configure_domain
    
    # Setup directories
    setup_directories
    
    # Install Caddyfile
    install_caddyfile
    
    # Start Caddy
    start_caddy
    
    # Check AzuraCast
    check_azuracast
    
    # Deploy static files if available
    deploy_static
    
    # Test configuration
    test_configuration
    
    # Show final instructions
    show_instructions
}

# Run main function
main "$@"