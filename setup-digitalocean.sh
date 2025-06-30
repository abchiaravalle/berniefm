#!/bin/bash

# BC Radio DigitalOcean Setup Script
# Automated deployment using DigitalOcean API

set -e

echo "🌊 BC Radio DigitalOcean Setup"
echo "=============================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Configuration
DO_CONFIG_FILE="do-config.json"
DROPLET_NAME="bc-radio-server"
FIREWALL_NAME="bc-radio-firewall"
PROJECT_NAME="BC Radio"

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

print_api() {
    echo -e "${PURPLE}[API]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check if doctl is installed
    if ! command -v doctl &> /dev/null; then
        print_error "doctl (DigitalOcean CLI) is not installed"
        echo ""
        echo "Install doctl:"
        echo "• macOS: brew install doctl"
        echo "• Ubuntu/Debian: snap install doctl"
        echo "• Manual: https://docs.digitalocean.com/reference/doctl/how-to/install/"
        echo ""
        exit 1
    fi
    
    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        print_warning "jq is not installed, installing..."
        if [[ "$OSTYPE" == "linux-gnu"* ]]; then
            if command -v apt &> /dev/null; then
                sudo apt update && sudo apt install -y jq
            elif command -v yum &> /dev/null; then
                sudo yum install -y jq
            fi
        elif [[ "$OSTYPE" == "darwin"* ]]; then
            if command -v brew &> /dev/null; then
                brew install jq
            fi
        fi
    fi
    
    print_success "Prerequisites checked"
}

# Setup DigitalOcean authentication
setup_do_auth() {
    print_status "Setting up DigitalOcean authentication..."
    
    # Check if already authenticated
    if doctl auth list | grep -q "current"; then
        print_success "Already authenticated with DigitalOcean"
        return 0
    fi
    
    echo ""
    echo "You need a DigitalOcean API token to continue."
    echo "Get one at: https://cloud.digitalocean.com/account/api/tokens"
    echo ""
    read -p "Enter your DigitalOcean API token: " -s DO_TOKEN
    echo ""
    
    if [[ -z "$DO_TOKEN" ]]; then
        print_error "API token is required"
        exit 1
    fi
    
    # Authenticate
    doctl auth init --access-token "$DO_TOKEN"
    
    if doctl account get &> /dev/null; then
        print_success "Successfully authenticated with DigitalOcean"
    else
        print_error "Authentication failed"
        exit 1
    fi
}

# Create configuration file
create_config() {
    print_status "Creating configuration..."
    
    # Get user input
    read -p "Enter your domain name (e.g., radio.example.com): " DOMAIN
    read -p "Enter droplet region [nyc1]: " REGION
    REGION=${REGION:-nyc1}
    read -p "Enter droplet size [s-2vcpu-4gb]: " SIZE
    SIZE=${SIZE:-s-2vcpu-4gb}
    
    # Create SSH key if needed
    SSH_KEY_NAME="bc-radio-key"
    if [[ ! -f ~/.ssh/id_rsa ]]; then
        print_status "Creating SSH key..."
        ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa -N ""
    fi
    
    # Upload SSH key to DigitalOcean
    print_api "Uploading SSH key to DigitalOcean..."
    SSH_KEY_ID=$(doctl compute ssh-key create "$SSH_KEY_NAME" \
        --public-key-file ~/.ssh/id_rsa.pub \
        --format ID --no-header 2>/dev/null || \
        doctl compute ssh-key list --format ID,Name --no-header | \
        grep "$SSH_KEY_NAME" | awk '{print $1}')
    
    if [[ -z "$SSH_KEY_ID" ]]; then
        print_error "Failed to create/find SSH key"
        exit 1
    fi
    
    print_success "SSH key ready: $SSH_KEY_ID"
    
    # Create configuration file
    cat > "$DO_CONFIG_FILE" << EOF
{
  "domain": "$DOMAIN",
  "droplet": {
    "name": "$DROPLET_NAME",
    "region": "$REGION",
    "size": "$SIZE",
    "image": "ubuntu-22-04-x64",
    "ssh_keys": ["$SSH_KEY_ID"],
    "monitoring": true,
    "backups": true,
    "ipv6": true,
    "vpc_uuid": null,
    "tags": ["bc-radio", "production"]
  },
  "firewall": {
    "name": "$FIREWALL_NAME",
    "inbound_rules": [
      {
        "protocol": "tcp",
        "ports": "22",
        "sources": {
          "addresses": ["0.0.0.0/0", "::/0"]
        }
      },
      {
        "protocol": "tcp",
        "ports": "80",
        "sources": {
          "addresses": ["0.0.0.0/0", "::/0"]
        }
      },
      {
        "protocol": "tcp",
        "ports": "443",
        "sources": {
          "addresses": ["0.0.0.0/0", "::/0"]
        }
      },
      {
        "protocol": "tcp",
        "ports": "8000-8999",
        "sources": {
          "addresses": ["0.0.0.0/0", "::/0"]
        }
      }
    ],
    "outbound_rules": [
      {
        "protocol": "tcp",
        "ports": "all",
        "destinations": {
          "addresses": ["0.0.0.0/0", "::/0"]
        }
      },
      {
        "protocol": "udp",
        "ports": "all",
        "destinations": {
          "addresses": ["0.0.0.0/0", "::/0"]
        }
      }
    ]
  },
  "project": {
    "name": "$PROJECT_NAME",
    "description": "BC Radio Livestream Server",
    "purpose": "Web Application",
    "environment": "Production"
  }
}
EOF
    
    print_success "Configuration saved to $DO_CONFIG_FILE"
}

# Create or get project
setup_project() {
    print_status "Setting up DigitalOcean project..."
    
    PROJECT_NAME=$(jq -r '.project.name' "$DO_CONFIG_FILE")
    
    # Check if project exists
    PROJECT_ID=$(doctl projects list --format ID,Name --no-header | \
        grep "$PROJECT_NAME" | awk '{print $1}' || true)
    
    if [[ -z "$PROJECT_ID" ]]; then
        print_api "Creating new project: $PROJECT_NAME"
        PROJECT_ID=$(doctl projects create \
            --name "$PROJECT_NAME" \
            --description "$(jq -r '.project.description' "$DO_CONFIG_FILE")" \
            --purpose "$(jq -r '.project.purpose' "$DO_CONFIG_FILE")" \
            --environment "$(jq -r '.project.environment' "$DO_CONFIG_FILE")" \
            --format ID --no-header)
    fi
    
    if [[ -n "$PROJECT_ID" ]]; then
        print_success "Project ready: $PROJECT_ID"
        # Update config with project ID
        jq ".project.id = \"$PROJECT_ID\"" "$DO_CONFIG_FILE" > tmp.json && mv tmp.json "$DO_CONFIG_FILE"
    else
        print_warning "Could not create/find project, continuing without project assignment"
    fi
}

# Create firewall
create_firewall() {
    print_status "Creating firewall rules..."
    
    FIREWALL_NAME=$(jq -r '.firewall.name' "$DO_CONFIG_FILE")
    
    # Check if firewall exists
    FIREWALL_ID=$(doctl compute firewall list --format ID,Name --no-header | \
        grep "$FIREWALL_NAME" | awk '{print $1}' || true)
    
    if [[ -n "$FIREWALL_ID" ]]; then
        print_success "Firewall already exists: $FIREWALL_ID"
    else
        print_api "Creating firewall: $FIREWALL_NAME"
        
        # Create firewall with rules
        FIREWALL_ID=$(doctl compute firewall create \
            --name "$FIREWALL_NAME" \
            --inbound-rules "protocol:tcp,ports:22,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:80,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:443,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:8000-8999,address:0.0.0.0/0,address:::/0" \
            --outbound-rules "protocol:tcp,ports:all,address:0.0.0.0/0,address:::/0 protocol:udp,ports:all,address:0.0.0.0/0,address:::/0" \
            --format ID --no-header)
        
        if [[ -n "$FIREWALL_ID" ]]; then
            print_success "Firewall created: $FIREWALL_ID"
        else
            print_error "Failed to create firewall"
            exit 1
        fi
    fi
    
    # Update config with firewall ID
    jq ".firewall.id = \"$FIREWALL_ID\"" "$DO_CONFIG_FILE" > tmp.json && mv tmp.json "$DO_CONFIG_FILE"
}

# Create droplet
create_droplet() {
    print_status "Creating droplet..."
    
    DROPLET_NAME=$(jq -r '.droplet.name' "$DO_CONFIG_FILE")
    
    # Check if droplet exists
    DROPLET_ID=$(doctl compute droplet list --format ID,Name --no-header | \
        grep "$DROPLET_NAME" | awk '{print $1}' || true)
    
    if [[ -n "$DROPLET_ID" ]]; then
        print_success "Droplet already exists: $DROPLET_ID"
    else
        print_api "Creating droplet: $DROPLET_NAME"
        
        # Get configuration
        REGION=$(jq -r '.droplet.region' "$DO_CONFIG_FILE")
        SIZE=$(jq -r '.droplet.size' "$DO_CONFIG_FILE")
        IMAGE=$(jq -r '.droplet.image' "$DO_CONFIG_FILE")
        SSH_KEYS=$(jq -r '.droplet.ssh_keys[]' "$DO_CONFIG_FILE" | tr '\n' ',' | sed 's/,$//')
        
        # Create droplet
        DROPLET_ID=$(doctl compute droplet create "$DROPLET_NAME" \
            --region "$REGION" \
            --size "$SIZE" \
            --image "$IMAGE" \
            --ssh-keys "$SSH_KEYS" \
            --enable-monitoring \
            --enable-backups \
            --enable-ipv6 \
            --tag-names "bc-radio,production" \
            --user-data-file <(cat << 'USERDATA'
#!/bin/bash
apt-get update
apt-get install -y docker.io docker-compose python3 python3-pip curl wget
systemctl enable docker
systemctl start docker
usermod -aG docker $USER
# Install doctl for the user
snap install doctl
# Setup Docker Compose v2
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
USERDATA
) \
            --wait \
            --format ID --no-header)
        
        if [[ -n "$DROPLET_ID" ]]; then
            print_success "Droplet created: $DROPLET_ID"
        else
            print_error "Failed to create droplet"
            exit 1
        fi
    fi
    
    # Update config with droplet ID
    jq ".droplet.id = \"$DROPLET_ID\"" "$DO_CONFIG_FILE" > tmp.json && mv tmp.json "$DO_CONFIG_FILE"
    
    # Get droplet IP
    print_status "Getting droplet IP address..."
    sleep 10  # Wait for droplet to be ready
    DROPLET_IP=$(doctl compute droplet get "$DROPLET_ID" --format PublicIPv4 --no-header)
    
    if [[ -n "$DROPLET_IP" ]]; then
        print_success "Droplet IP: $DROPLET_IP"
        jq ".droplet.ip = \"$DROPLET_IP\"" "$DO_CONFIG_FILE" > tmp.json && mv tmp.json "$DO_CONFIG_FILE"
    else
        print_error "Could not get droplet IP"
        exit 1
    fi
}

# Apply firewall to droplet
apply_firewall() {
    print_status "Applying firewall to droplet..."
    
    FIREWALL_ID=$(jq -r '.firewall.id' "$DO_CONFIG_FILE")
    DROPLET_ID=$(jq -r '.droplet.id' "$DO_CONFIG_FILE")
    
    print_api "Assigning firewall $FIREWALL_ID to droplet $DROPLET_ID"
    doctl compute firewall add-droplets "$FIREWALL_ID" --droplet-ids "$DROPLET_ID"
    
    print_success "Firewall applied to droplet"
}

# Create and assign reserved IP
setup_reserved_ip() {
    print_status "Setting up reserved IP..."
    
    DROPLET_ID=$(jq -r '.droplet.id' "$DO_CONFIG_FILE")
    REGION=$(jq -r '.droplet.region' "$DO_CONFIG_FILE")
    
    # Check if reserved IP already exists for this droplet
    RESERVED_IP=$(doctl compute reserved-ip list --format IP,DropletID --no-header | \
        grep "$DROPLET_ID" | awk '{print $1}' || true)
    
    if [[ -n "$RESERVED_IP" ]]; then
        print_success "Reserved IP already assigned: $RESERVED_IP"
    else
        print_api "Creating reserved IP..."
        RESERVED_IP=$(doctl compute reserved-ip create \
            --region "$REGION" \
            --type assign \
            --resource "$DROPLET_ID" \
            --format IP --no-header)
        
        if [[ -n "$RESERVED_IP" ]]; then
            print_success "Reserved IP created and assigned: $RESERVED_IP"
        else
            print_warning "Could not create reserved IP, using droplet IP"
            RESERVED_IP=$(jq -r '.droplet.ip' "$DO_CONFIG_FILE")
        fi
    fi
    
    # Update config
    jq ".droplet.reserved_ip = \"$RESERVED_IP\"" "$DO_CONFIG_FILE" > tmp.json && mv tmp.json "$DO_CONFIG_FILE"
}

# Assign resources to project
assign_to_project() {
    print_status "Assigning resources to project..."
    
    PROJECT_ID=$(jq -r '.project.id' "$DO_CONFIG_FILE" 2>/dev/null || echo "")
    
    if [[ -z "$PROJECT_ID" || "$PROJECT_ID" == "null" ]]; then
        print_warning "No project ID found, skipping project assignment"
        return 0
    fi
    
    DROPLET_ID=$(jq -r '.droplet.id' "$DO_CONFIG_FILE")
    FIREWALL_ID=$(jq -r '.firewall.id' "$DO_CONFIG_FILE")
    
    # Assign droplet to project
    print_api "Assigning droplet to project..."
    doctl projects resources assign "$PROJECT_ID" \
        --resource "do:droplet:$DROPLET_ID" || true
    
    # Assign firewall to project
    print_api "Assigning firewall to project..."
    doctl projects resources assign "$PROJECT_ID" \
        --resource "do:firewall:$FIREWALL_ID" || true
    
    print_success "Resources assigned to project"
}

# Wait for droplet to be ready
wait_for_droplet() {
    print_status "Waiting for droplet to be ready..."
    
    DROPLET_IP=$(jq -r '.droplet.reserved_ip // .droplet.ip' "$DO_CONFIG_FILE")
    
    # Wait for SSH to be available
    for i in {1..30}; do
        if ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no root@"$DROPLET_IP" "echo 'SSH ready'" 2>/dev/null; then
            print_success "Droplet is ready for SSH connection"
            return 0
        fi
        print_status "Waiting for SSH... (attempt $i/30)"
        sleep 10
    done
    
    print_error "Droplet did not become ready in time"
    exit 1
}

# Deploy BC Radio to droplet
deploy_bc_radio() {
    print_status "Deploying BC Radio to droplet..."
    
    DROPLET_IP=$(jq -r '.droplet.reserved_ip // .droplet.ip' "$DO_CONFIG_FILE")
    DOMAIN=$(jq -r '.domain' "$DO_CONFIG_FILE")
    
    # Create deployment package
    print_status "Creating deployment package..."
    tar -czf bc-radio-deploy.tar.gz \
        --exclude='music' \
        --exclude='azuracast_*' \
        --exclude='*.tar.gz' \
        --exclude='.git' \
        --exclude='node_modules' \
        --exclude='dist' \
        .
    
    # Copy files to droplet
    print_api "Copying files to droplet..."
    scp -o StrictHostKeyChecking=no bc-radio-deploy.tar.gz root@"$DROPLET_IP":/root/
    
    # Execute deployment script on droplet
    print_api "Executing deployment on droplet..."
    ssh -o StrictHostKeyChecking=no root@"$DROPLET_IP" << DEPLOY_SCRIPT
set -e

# Extract files
cd /root
tar -xzf bc-radio-deploy.tar.gz
cd bc-radio-*/ || cd /root

# Make scripts executable
chmod +x *.sh *.py

# Run setup
./setup.sh --skip-prompts

# Setup Caddy with domain
echo "$DOMAIN" | ./setup-caddy.sh --domain-from-stdin

# Create build config
python3 build.py --init
sed -i 's/yourdomain.com/$DOMAIN/g' build.config.json
sed -i 's|https://yourdomain.com|https://$DOMAIN|g' build.config.json

# Build and deploy
python3 build.py

echo "Deployment complete!"
DEPLOY_SCRIPT
    
    # Clean up
    rm -f bc-radio-deploy.tar.gz
    
    print_success "BC Radio deployed successfully!"
}

# Setup DNS instructions
show_dns_instructions() {
    print_status "DNS Configuration Required"
    
    DOMAIN=$(jq -r '.domain' "$DO_CONFIG_FILE")
    DROPLET_IP=$(jq -r '.droplet.reserved_ip // .droplet.ip' "$DO_CONFIG_FILE")
    
    echo ""
    echo "🌐 DNS Configuration"
    echo "===================="
    echo ""
    echo "Add these DNS records to your domain provider:"
    echo ""
    echo "A Record:"
    echo "  Name: @ (or leave blank for root domain)"
    echo "  Value: $DROPLET_IP"
    echo "  TTL: 300"
    echo ""
    echo "CNAME Record (optional, for www):"
    echo "  Name: www"
    echo "  Value: $DOMAIN"
    echo "  TTL: 300"
    echo ""
    echo "After DNS propagation (5-30 minutes), your radio will be available at:"
    echo "🎵 https://$DOMAIN"
    echo ""
}

# Show final summary
show_summary() {
    echo ""
    echo "🎉 DigitalOcean Deployment Complete!"
    echo "===================================="
    echo ""
    
    DOMAIN=$(jq -r '.domain' "$DO_CONFIG_FILE")
    DROPLET_IP=$(jq -r '.droplet.reserved_ip // .droplet.ip' "$DO_CONFIG_FILE")
    DROPLET_ID=$(jq -r '.droplet.id' "$DO_CONFIG_FILE")
    
    echo "📊 Deployment Summary:"
    echo "• Domain: $DOMAIN"
    echo "• Server IP: $DROPLET_IP"
    echo "• Droplet ID: $DROPLET_ID"
    echo "• Firewall: Configured"
    echo "• Reserved IP: Assigned"
    echo "• SSL: Automatic (Caddy)"
    echo ""
    echo "🔗 Access URLs:"
    echo "• Radio: https://$DOMAIN"
    echo "• Admin: https://$DOMAIN/admin"
    echo "• Stream: https://$DOMAIN/stream/listen"
    echo "• API: https://$DOMAIN/api/nowplaying"
    echo ""
    echo "🛠️ Management Commands:"
    echo "• SSH: ssh root@$DROPLET_IP"
    echo "• Check status: doctl compute droplet get $DROPLET_ID"
    echo "• View logs: ssh root@$DROPLET_IP 'docker-compose logs'"
    echo ""
    echo "💰 Monthly Cost Estimate:"
    SIZE=$(jq -r '.droplet.size' "$DO_CONFIG_FILE")
    case $SIZE in
        "s-1vcpu-1gb") echo "• Droplet: ~\$6/month" ;;
        "s-2vcpu-4gb") echo "• Droplet: ~\$24/month" ;;
        "s-4vcpu-8gb") echo "• Droplet: ~\$48/month" ;;
        *) echo "• Droplet: Check DigitalOcean pricing" ;;
    esac
    echo "• Reserved IP: \$4/month"
    echo "• Backups: 20% of droplet cost"
    echo ""
    echo "📚 Next Steps:"
    echo "1. Configure DNS records (see above)"
    echo "2. Wait for DNS propagation"
    echo "3. Access https://$DOMAIN to configure AzuraCast"
    echo "4. Follow AZURACAST_CONFIGURATION.md for detailed setup"
    echo ""
    echo "🎵 Enjoy your BC Radio livestream! 🎵"
}

# Main execution
main() {
    print_status "Starting DigitalOcean deployment..."
    
    # Check prerequisites
    check_prerequisites
    
    # Setup authentication
    setup_do_auth
    
    # Create configuration
    if [[ ! -f "$DO_CONFIG_FILE" ]]; then
        create_config
    else
        print_status "Using existing configuration: $DO_CONFIG_FILE"
    fi
    
    # Setup project
    setup_project
    
    # Create firewall
    create_firewall
    
    # Create droplet
    create_droplet
    
    # Apply firewall
    apply_firewall
    
    # Setup reserved IP
    setup_reserved_ip
    
    # Assign to project
    assign_to_project
    
    # Wait for droplet
    wait_for_droplet
    
    # Deploy BC Radio
    deploy_bc_radio
    
    # Show DNS instructions
    show_dns_instructions
    
    # Show summary
    show_summary
}

# Handle command line arguments
case "${1:-}" in
    --help|-h)
        echo "BC Radio DigitalOcean Setup"
        echo ""
        echo "Usage: $0 [options]"
        echo ""
        echo "Options:"
        echo "  --help, -h     Show this help message"
        echo "  --config FILE  Use specific configuration file"
        echo "  --destroy      Destroy all created resources"
        echo ""
        exit 0
        ;;
    --destroy)
        if [[ -f "$DO_CONFIG_FILE" ]]; then
            echo "⚠️  This will destroy all BC Radio resources on DigitalOcean!"
            read -p "Are you sure? (type 'yes' to confirm): " CONFIRM
            if [[ "$CONFIRM" == "yes" ]]; then
                DROPLET_ID=$(jq -r '.droplet.id' "$DO_CONFIG_FILE" 2>/dev/null || echo "")
                FIREWALL_ID=$(jq -r '.firewall.id' "$DO_CONFIG_FILE" 2>/dev/null || echo "")
                
                [[ -n "$DROPLET_ID" && "$DROPLET_ID" != "null" ]] && doctl compute droplet delete "$DROPLET_ID" --force
                [[ -n "$FIREWALL_ID" && "$FIREWALL_ID" != "null" ]] && doctl compute firewall delete "$FIREWALL_ID" --force
                
                rm -f "$DO_CONFIG_FILE"
                echo "Resources destroyed."
            fi
        else
            echo "No configuration file found."
        fi
        exit 0
        ;;
    --config)
        DO_CONFIG_FILE="$2"
        shift 2
        ;;
esac

# Run main function
main "$@"