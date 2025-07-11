#!/usr/bin/env python3
"""
BC Radio DNS Configuration Generator
Generates DNS instructions for any domain and server IP.
"""

import argparse
import sys
import socket
import re

def validate_domain(domain):
    """Validate domain format"""
    pattern = r'^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$'
    return re.match(pattern, domain) is not None

def validate_ip(ip):
    """Validate IP address format"""
    try:
        socket.inet_aton(ip)
        return True
    except socket.error:
        return False

def generate_dns_instructions(domain, server_ip):
    """Generate comprehensive DNS instructions"""
    
    print(f"🌐 DNS Configuration for BC Radio")
    print("=" * 50)
    print()
    print(f"🎯 Domain: {domain}")
    print(f"🖥️  Server IP: {server_ip}")
    print()
    print("⚠️  IMPORTANT: Configure these DNS records at your domain provider!")
    print()
    
    # DNS Records Table
    print("📋 DNS Records to Add:")
    print("=" * 30)
    print()
    print(f"{'Type':<8} {'Name':<12} {'Value':<20} {'TTL':<8} {'Purpose'}")
    print(f"{'----':<8} {'----':<12} {'-----':<20} {'---':<8} {'-------'}")
    print(f"{'A':<8} {'@':<12} {server_ip:<20} {'300':<8} {'Main domain'}")
    print(f"{'CNAME':<8} {'www':<12} {domain:<20} {'300':<8} {'WWW subdomain'}")
    print(f"{'CNAME':<8} {'stream':<12} {domain:<20} {'300':<8} {'Stream subdomain'}")
    print()
    
    # Provider-specific instructions
    print("🔧 Provider-Specific Instructions:")
    print("=" * 40)
    print()
    
    providers = [
        {
            "name": "🟦 Cloudflare",
            "steps": [
                "1. Go to cloudflare.com → Your domain → DNS → Records",
                "2. Click 'Add record' for each record above",
                "3. Set Proxy status to 'DNS only' (gray cloud) for best compatibility",
                "4. Save each record"
            ],
            "notes": "• Fastest DNS propagation (2-5 minutes)\n• Offers free SSL and CDN"
        },
        {
            "name": "🟨 Namecheap",
            "steps": [
                "1. Go to namecheap.com → Domain List → Manage → Advanced DNS",
                "2. Delete any existing A records pointing to parking page",
                "3. Add new A record: Host '@', Value: server IP",
                "4. Add CNAME records as shown above"
            ],
            "notes": "• Propagation: 5-30 minutes\n• May need to remove default parking records"
        },
        {
            "name": "🟩 GoDaddy",
            "steps": [
                "1. Go to godaddy.com → My Products → DNS → Manage Zones",
                "2. Find your domain and click 'DNS'",
                "3. Edit existing A record or add new one with '@' and server IP",
                "4. Add CNAME records for www and stream"
            ],
            "notes": "• Propagation: 10-60 minutes\n• Interface can be slow to update"
        },
        {
            "name": "🟪 Domain.com",
            "steps": [
                "1. Go to domain.com → My Account → DNS → Manage",
                "2. Select your domain",
                "3. Add/edit A record for @ pointing to server IP",
                "4. Add CNAME records for subdomains"
            ],
            "notes": "• Propagation: 15-60 minutes"
        },
        {
            "name": "🔵 Google Domains",
            "steps": [
                "1. Go to domains.google.com → Your domain → DNS",
                "2. Scroll to 'Custom resource records'",
                "3. Add A record: @ → server IP",
                "4. Add CNAME records: www → domain, stream → domain"
            ],
            "notes": "• Propagation: 5-30 minutes\n• Clean, simple interface"
        }
    ]
    
    for provider in providers:
        print(provider["name"])
        for step in provider["steps"]:
            print(f"   {step}")
        print(f"   {provider['notes']}")
        print()
    
    # Copy-paste ready records
    print("📱 Copy-Paste Ready Records:")
    print("=" * 35)
    print()
    print("A Record:")
    print(f"   Name: @")
    print(f"   Value: {server_ip}")
    print(f"   TTL: 300")
    print()
    print("CNAME Record (www):")
    print(f"   Name: www")
    print(f"   Value: {domain}")
    print(f"   TTL: 300")
    print()
    print("CNAME Record (stream):")
    print(f"   Name: stream")
    print(f"   Value: {domain}")
    print(f"   TTL: 300")
    print()
    
    # Propagation timeline
    print("⏱️  DNS Propagation Timeline:")
    print("=" * 35)
    print("• Cloudflare: 2-5 minutes")
    print("• Namecheap: 5-30 minutes") 
    print("• GoDaddy: 10-60 minutes")
    print("• Domain.com: 15-60 minutes")
    print("• Google Domains: 5-30 minutes")
    print("• Others: Up to 24 hours")
    print()
    
    # Final URLs
    print("✅ After DNS propagation, your BC Radio will be available at:")
    print("=" * 65)
    print(f"🎵 Main Site: https://{domain}")
    print(f"🔧 Admin: https://{domain}/admin")
    print(f"📻 Stream: https://stream.{domain}/listen")
    print(f"🔌 API: https://{domain}/api/nowplaying")
    print()
    
    # Testing commands
    print("🧪 Test Your DNS Setup:")
    print("=" * 30)
    print()
    print("# Check if DNS is working:")
    print(f"dig {domain}")
    print(f"dig stream.{domain}")
    print(f"nslookup {domain}")
    print()
    print("# Test your site (after DNS propagation):")
    print(f"curl -I https://{domain}")
    print(f"curl https://{domain}/api/nowplaying")
    print(f"curl -I https://stream.{domain}/listen")
    print()
    
    # Troubleshooting
    print("🆘 Troubleshooting:")
    print("=" * 20)
    print("• If DNS doesn't resolve: Wait longer, DNS can take time")
    print("• If HTTPS doesn't work: DNS must resolve first for SSL certificates")
    print("• If stream doesn't work: Check stream subdomain DNS record")
    print("• Still having issues? Check with your DNS provider's support")
    print()
    
    # Save to file option
    print("💾 Save Instructions:")
    print("=" * 25)
    print(f"These instructions have been displayed for {domain}")
    print("You can run this script again anytime with:")
    print(f"python3 configure-dns.py {domain} {server_ip}")
    print()

def main():
    parser = argparse.ArgumentParser(
        description="Generate DNS configuration instructions for BC Radio",
        epilog="Example: python3 configure-dns.py radio.example.com 1.2.3.4"
    )
    parser.add_argument('domain', help='Your domain name (e.g., radio.example.com)')
    parser.add_argument('server_ip', help='Your server IP address')
    parser.add_argument('--save', help='Save instructions to file', metavar='FILE')
    
    args = parser.parse_args()
    
    # Validate inputs
    domain = args.domain.lower().strip()
    server_ip = args.server_ip.strip()
    
    if not validate_domain(domain):
        print("❌ Invalid domain format")
        print("Domain should be like: example.com or radio.example.com")
        sys.exit(1)
    
    if not validate_ip(server_ip):
        print("❌ Invalid IP address format")
        print("IP should be like: 192.168.1.1 or 10.0.0.1")
        sys.exit(1)
    
    # Generate instructions
    if args.save:
        # Redirect output to file
        import io
        import contextlib
        
        f = io.StringIO()
        with contextlib.redirect_stdout(f):
            generate_dns_instructions(domain, server_ip)
        
        with open(args.save, 'w') as file:
            file.write(f.getvalue())
        
        print(f"✅ DNS instructions saved to: {args.save}")
        print(f"📧 You can email this file to whoever manages your DNS")
    else:
        generate_dns_instructions(domain, server_ip)

if __name__ == "__main__":
    main()