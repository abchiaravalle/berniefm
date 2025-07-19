#!/usr/bin/env python3
"""
BC Radio Legal Compliance Helper
Helps ensure legal compliance for radio broadcasting.
"""

import json
import sys
from datetime import datetime
from pathlib import Path

def generate_privacy_policy(domain):
    """Generate a basic privacy policy"""
    
    policy = f"""
# Privacy Policy for {domain}

**Effective Date:** {datetime.now().strftime('%B %d, %Y')}

## Information We Collect

### Automatically Collected Information
- IP address and location data
- Device type and browser information
- Listening duration and preferences
- Stream quality metrics

### Cookies and Tracking
- We use cookies to improve your experience
- Analytics cookies help us understand usage patterns
- You can disable cookies in your browser settings

## How We Use Information

- Provide and improve our streaming service
- Analyze listener patterns and preferences
- Ensure technical functionality
- Comply with legal requirements

## Information Sharing

We do not sell personal information. We may share data with:
- Service providers (hosting, analytics)
- Legal authorities when required by law

## Your Rights

- Access your personal data
- Request deletion of your data
- Opt out of analytics tracking
- Contact us with privacy concerns

## Contact Information

For privacy questions, contact: privacy@{domain}

## Updates

This policy may be updated. Check this page for changes.
"""
    
    with open('privacy_policy.md', 'w') as f:
        f.write(policy)
    
    print("✅ Privacy policy generated: privacy_policy.md")

def generate_terms_of_service(domain):
    """Generate basic terms of service"""
    
    terms = f"""
# Terms of Service for {domain}

**Effective Date:** {datetime.now().strftime('%B %d, %Y')}

## Acceptance of Terms

By using {domain}, you agree to these terms.

## Use of Service

### Permitted Use
- Personal, non-commercial listening
- Sharing links to our stream
- Enjoying Bernie Chiaravalle's music

### Prohibited Use
- Recording or redistributing our stream
- Attempting to hack or disrupt service
- Commercial use without permission
- Violating copyright laws

## Intellectual Property

- All music is owned by respective copyright holders
- Stream content is protected by copyright
- Bernie Chiaravalle music used with permission

## Disclaimers

- Service provided "as is"
- No guarantee of uninterrupted service
- Not liable for service interruptions

## Limitation of Liability

Our liability is limited to the maximum extent permitted by law.

## Governing Law

These terms are governed by [Your Jurisdiction] law.

## Contact Information

For questions about these terms: legal@{domain}

## Changes to Terms

We may update these terms. Continued use constitutes acceptance.
"""
    
    with open('terms_of_service.md', 'w') as f:
        f.write(terms)
    
    print("✅ Terms of service generated: terms_of_service.md")

def generate_dmca_policy(domain):
    """Generate DMCA compliance policy"""
    
    dmca = f"""
# DMCA Copyright Policy for {domain}

## Copyright Infringement Notification

If you believe content on our service infringes your copyright:

### Required Information
1. Your contact information
2. Description of copyrighted work
3. Location of infringing material
4. Statement of good faith belief
5. Statement of accuracy under penalty of perjury
6. Your physical or electronic signature

### Send Notices To
**DMCA Agent:** [Your Name]
**Email:** dmca@{domain}
**Address:** [Your Address]

## Counter-Notification

If you believe content was removed in error:

### Required Information
1. Your contact information
2. Description of removed material
3. Statement under penalty of perjury
4. Consent to jurisdiction
5. Your physical or electronic signature

## Repeat Infringer Policy

We will terminate accounts of repeat infringers.

## Contact Information

For DMCA matters: dmca@{domain}
"""
    
    with open('dmca_policy.md', 'w') as f:
        f.write(dmca)
    
    print("✅ DMCA policy generated: dmca_policy.md")

def create_broadcast_log():
    """Create broadcast logging system"""
    
    log_script = """#!/usr/bin/env python3
\"\"\"
BC Radio Broadcast Logger
Logs what's playing for legal compliance.
\"\"\"

import requests
import json
import csv
from datetime import datetime
import time

def log_now_playing():
    \"\"\"Log currently playing track\"\"\"
    try:
        # Get now playing from AzuraCast API
        response = requests.get('http://localhost:8000/api/nowplaying')
        data = response.json()
        
        if 'now_playing' in data:
            track = data['now_playing']['song']
            
            # Create log entry
            log_entry = {
                'timestamp': datetime.now().isoformat(),
                'title': track.get('title', 'Unknown'),
                'artist': track.get('artist', 'Unknown'),
                'album': track.get('album', 'Unknown'),
                'duration': track.get('duration', 0)
            }
            
            # Write to CSV log
            with open('broadcast_log.csv', 'a', newline='') as f:
                writer = csv.DictWriter(f, fieldnames=log_entry.keys())
                
                # Write header if file is empty
                if f.tell() == 0:
                    writer.writeheader()
                
                writer.writerow(log_entry)
            
            print(f"Logged: {track.get('artist')} - {track.get('title')}")
    
    except Exception as e:
        print(f"Error logging: {e}")

def main():
    \"\"\"Main logging loop\"\"\"
    print("Starting broadcast logger...")
    
    while True:
        log_now_playing()
        time.sleep(30)  # Log every 30 seconds

if __name__ == "__main__":
    main()
"""
    
    with open('broadcast_logger.py', 'w') as f:
        f.write(log_script)
    
    import os
    os.chmod('broadcast_logger.py', 0o755)
    
    print("✅ Broadcast logger created: broadcast_logger.py")

def check_music_licensing():
    """Check music licensing requirements"""
    
    print("🎵 Music Licensing Requirements")
    print("=" * 40)
    print()
    print("For legal streaming, you need licenses from:")
    print()
    print("📻 Performance Rights Organizations:")
    print("• ASCAP - https://www.ascap.com/")
    print("• BMI - https://www.bmi.com/")
    print("• SESAC - https://www.sesac.com/")
    print()
    print("🌐 Digital Performance Rights:")
    print("• SoundExchange - https://www.soundexchange.com/")
    print()
    print("🎼 Mechanical Rights:")
    print("• Harry Fox Agency - https://www.harryfox.com/")
    print("• Music Reports - https://www.musicreports.com/")
    print()
    print("💰 Estimated Costs (varies by audience size):")
    print("• ASCAP: $288-$2,500/year")
    print("• BMI: $288-$2,500/year") 
    print("• SESAC: Contact for pricing")
    print("• SoundExchange: Percentage of revenue")
    print()
    print("⚠️  Important Notes:")
    print("• Costs depend on your audience size")
    print("• You need ALL applicable licenses")
    print("• Some licenses have minimum fees")
    print("• International streaming may require additional licenses")
    print()
    print("📞 Next Steps:")
    print("1. Contact each PRO for rate quotes")
    print("2. Determine your expected audience size")
    print("3. Apply for licenses before going live")
    print("4. Keep detailed broadcast logs")

def generate_station_id():
    """Generate station identification requirements"""
    
    print("📻 Station Identification Requirements")
    print("=" * 45)
    print()
    print("Legal Requirements:")
    print("• Station must identify itself regularly")
    print("• Include call sign or station name")
    print("• Include city of license")
    print("• Required at least once per hour")
    print()
    print("Example Station ID:")
    print("\"You're listening to BC Radio, streaming from [Your City]\"")
    print()
    print("📝 Implementation:")
    print("1. Create audio file with station ID")
    print("2. Configure AzuraCast to play hourly")
    print("3. Add to playlist rotation")
    print("4. Log all station ID broadcasts")

def main():
    """Main compliance helper"""
    print("⚖️  BC Radio Legal Compliance Helper")
    print("=" * 50)
    print()
    
    if len(sys.argv) < 2:
        print("Usage: python3 legal-compliance.py <command> [domain]")
        print()
        print("Commands:")
        print("  privacy <domain>     - Generate privacy policy")
        print("  terms <domain>       - Generate terms of service")
        print("  dmca <domain>        - Generate DMCA policy")
        print("  logging              - Setup broadcast logging")
        print("  licensing            - Show licensing requirements")
        print("  station-id           - Show station ID requirements")
        print("  all <domain>         - Generate all documents")
        return
    
    command = sys.argv[1]
    domain = sys.argv[2] if len(sys.argv) > 2 else "yourdomain.com"
    
    if command == "privacy":
        generate_privacy_policy(domain)
    elif command == "terms":
        generate_terms_of_service(domain)
    elif command == "dmca":
        generate_dmca_policy(domain)
    elif command == "logging":
        create_broadcast_log()
    elif command == "licensing":
        check_music_licensing()
    elif command == "station-id":
        generate_station_id()
    elif command == "all":
        print(f"Generating all legal documents for {domain}...")
        print()
        generate_privacy_policy(domain)
        generate_terms_of_service(domain)
        generate_dmca_policy(domain)
        create_broadcast_log()
        print()
        print("📋 Legal Compliance Package Complete!")
        print("=" * 45)
        print("Generated files:")
        print("• privacy_policy.md")
        print("• terms_of_service.md") 
        print("• dmca_policy.md")
        print("• broadcast_logger.py")
        print()
        print("⚠️  Important:")
        print("• Review all documents with a lawyer")
        print("• Customize for your specific situation")
        print("• Update contact information")
        print("• Start broadcast logging before going live")
        print()
        check_music_licensing()
        print()
        generate_station_id()
    else:
        print(f"Unknown command: {command}")

if __name__ == "__main__":
    main()