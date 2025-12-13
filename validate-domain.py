#!/usr/bin/env python3
"""
Domain Validation Script for BC Radio
Validates domain configuration before deployment.
"""

import socket
import sys
import re
import subprocess
import argparse

def validate_domain_format(domain):
    """Validate domain name format"""
    pattern = r'^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$'
    return re.match(pattern, domain) is not None

def check_dns_resolution(domain):
    """Check if domain resolves to an IP"""
    try:
        ip = socket.gethostbyname(domain)
        return ip
    except socket.gaierror:
        return None

def check_domain_availability(domain):
    """Check if domain is available for configuration"""
    try:
        # Try to connect to see if anything is already running
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        result = sock.connect_ex((domain, 80))
        sock.close()
        return result != 0  # True if nothing is running (available)
    except:
        return True  # Assume available if we can't check

def check_subdomain_conflicts(domain):
    """Check for potential subdomain conflicts"""
    subdomains = ['www', 'admin', 'api', 'stream']
    conflicts = []
    
    for subdomain in subdomains:
        full_domain = f"{subdomain}.{domain}"
        if check_dns_resolution(full_domain):
            conflicts.append(full_domain)
    
    return conflicts

def suggest_alternatives(domain):
    """Suggest alternative domain names"""
    base = domain.split('.')[0]
    tld = '.'.join(domain.split('.')[1:])
    
    alternatives = [
        f"{base}-radio.{tld}",
        f"{base}radio.{tld}",
        f"radio-{base}.{tld}",
        f"{base}-stream.{tld}",
        f"{base}-live.{tld}"
    ]
    
    return alternatives

def main():
    parser = argparse.ArgumentParser(description="Validate domain for BC Radio deployment")
    parser.add_argument('domain', help='Domain name to validate')
    parser.add_argument('--target-ip', help='Expected target IP address')
    parser.add_argument('--check-conflicts', action='store_true', help='Check for subdomain conflicts')
    
    args = parser.parse_args()
    domain = args.domain.lower().strip()
    
    print(f"🔍 Validating domain: {domain}")
    print("=" * 50)
    
    # Format validation
    if not validate_domain_format(domain):
        print("❌ Invalid domain format")
        print("Domain should be in format: example.com or subdomain.example.com")
        sys.exit(1)
    else:
        print("✅ Domain format is valid")
    
    # DNS resolution check
    current_ip = check_dns_resolution(domain)
    if current_ip:
        print(f"🌐 Domain resolves to: {current_ip}")
        
        if args.target_ip:
            if current_ip == args.target_ip:
                print("✅ Domain points to target IP")
            else:
                print(f"⚠️  Domain points to {current_ip}, expected {args.target_ip}")
                print("You may need to update DNS records")
    else:
        print("🔍 Domain does not resolve (this is OK for new deployments)")
    
    # Availability check
    if check_domain_availability(domain):
        print("✅ Domain appears available for configuration")
    else:
        print("⚠️  Something is already running on this domain")
        print("This might interfere with the deployment")
    
    # Subdomain conflicts
    if args.check_conflicts:
        print("\n🔍 Checking subdomain conflicts...")
        conflicts = check_subdomain_conflicts(domain)
        if conflicts:
            print("⚠️  Found existing subdomains:")
            for conflict in conflicts:
                print(f"   • {conflict}")
            print("These may conflict with BC Radio endpoints")
        else:
            print("✅ No subdomain conflicts found")
    
    # Recommendations
    print("\n💡 Recommendations:")
    print("=" * 20)
    
    if current_ip:
        print("• Domain is already configured")
        print("• Make sure you have access to DNS management")
        print("• Consider creating a backup of current DNS records")
    else:
        print("• Domain is ready for initial configuration")
        print("• Prepare access to your DNS management panel")
    
    print(f"• BC Radio will be available at: https://{domain}")
    print(f"• Admin interface: https://{domain}/admin")
    print(f"• Stream URL: https://stream.{domain}/listen")
    print(f"• API endpoint: https://{domain}/api/nowplaying")
    
    # Alternative suggestions if there are issues
    if not check_domain_availability(domain) or (current_ip and not args.target_ip):
        print("\n🔄 Alternative domains to consider:")
        alternatives = suggest_alternatives(domain)
        for alt in alternatives[:3]:
            print(f"   • {alt}")
    
    print(f"\n✅ Domain validation complete for: {domain}")

if __name__ == "__main__":
    main()