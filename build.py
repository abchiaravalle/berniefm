#!/usr/bin/env python3
"""
BC Radio Build Script
Builds static index.html with configurable stream URLs for deployment.
"""

import os
import sys
import shutil
import json
from pathlib import Path
import argparse

def load_config(config_file="build.config.json"):
    """Load build configuration"""
    default_config = {
        "stream_url": "https://yourdomain.com",
        "api_endpoint": "/api/nowplaying",
        "stream_endpoint": "/stream/listen",
        "title": "BC Radio - Live Stream",
        "description": "Bernie Chiaravalle Live Stream",
        "domain": "yourdomain.com",
        "enable_pwa": True,
        "enable_analytics": False,
        "analytics_id": "",
        "social_links": {
            "apple_music": "https://music.apple.com/us/artist/bernie-chiaravalle/80848772",
            "spotify": "https://open.spotify.com/artist/4xt2hzGfXdXqKR2msI2gOj",
            "facebook": "https://www.facebook.com/berniechiaravalle/",
            "instagram": "https://www.instagram.com/bvchiaravalle/",
            "website": "https://www.berniechiaravalle.com/"
        }
    }
    
    config_path = Path(config_file)
    if config_path.exists():
        try:
            with open(config_path, 'r') as f:
                user_config = json.load(f)
                default_config.update(user_config)
        except Exception as e:
            print(f"⚠️  Error loading config file: {e}")
            print("Using default configuration")
    
    return default_config

def create_build_config(config_file="build.config.json"):
    """Create a sample build configuration file"""
    config = load_config()
    
    with open(config_file, 'w') as f:
        json.dump(config, f, indent=2)
    
    print(f"✅ Created {config_file}")
    print("Edit this file to customize your build configuration")

def build_html(config, output_dir="dist"):
    """Build the static HTML with configuration"""
    print("🏗️  Building static HTML...")
    
    # Create output directory
    dist_dir = Path(output_dir)
    dist_dir.mkdir(exist_ok=True)
    
    # Read the template
    template_file = Path("index-livestream.html")
    if not template_file.exists():
        print("❌ index-livestream.html not found")
        return False
    
    with open(template_file, 'r', encoding='utf-8') as f:
        html_content = f.read()
    
    # Replace configuration values
    replacements = {
        # URLs
        'http://localhost:8000': config['stream_url'],
        '/listen': config['stream_endpoint'],
        '/api/nowplaying': config['api_endpoint'],
        
        # Meta tags
        'BC Radio - Live Stream': config['title'],
        'Bernie Chiaravalle Live Stream': config['description'],
        
        # Social links
        'https://music.apple.com/us/artist/bernie-chiaravalle/80848772': config['social_links']['apple_music'],
        'https://open.spotify.com/artist/4xt2hzGfXdXqKR2msI2gOj': config['social_links']['spotify'],
        'https://www.facebook.com/berniechiaravalle/': config['social_links']['facebook'],
        'https://www.instagram.com/bvchiaravalle/': config['social_links']['instagram'],
        'https://www.berniechiaravalle.com/': config['social_links']['website'],
    }
    
    # Apply replacements
    for old_value, new_value in replacements.items():
        html_content = html_content.replace(old_value, new_value)
    
    # Update JavaScript configuration
    js_config = f"""
    // Build configuration
    const BUILD_CONFIG = {{
        streamUrl: '{config['stream_url']}',
        apiEndpoint: '{config['api_endpoint']}',
        streamEndpoint: '{config['stream_endpoint']}',
        domain: '{config['domain']}',
        enablePWA: {str(config['enable_pwa']).lower()},
        enableAnalytics: {str(config['enable_analytics']).lower()},
        analyticsId: '{config.get('analytics_id', '')}'
    }};
    
    // Dynamic URL configuration for static deployment
    const getBaseUrl = () => {{
        if (window.location.protocol === 'file:') {{
            return 'http://localhost:8000';
        }}
        return BUILD_CONFIG.streamUrl;
    }};
    
    const STREAM_URL = `${{getBaseUrl()}}${{BUILD_CONFIG.streamEndpoint}}`;
    const API_URL = `${{getBaseUrl()}}${{BUILD_CONFIG.apiEndpoint}}`;
    """
    
    # Replace the dynamic URL configuration
    old_js_config = """// Dynamic URL configuration
    const getBaseUrl = () => {
      if (window.location.protocol === 'file:') {
        return 'http://localhost:8000';
      }
      // For production, assume AzuraCast is on port 8000 of the same domain
      const protocol = window.location.protocol;
      const hostname = window.location.hostname;
      return `${protocol}//${hostname}:8000`;
    };
    
    const STREAM_URL = `${getBaseUrl()}/listen`;
    const API_URL = `${getBaseUrl()}/api/nowplaying`;"""
    
    html_content = html_content.replace(old_js_config, js_config)
    
    # Add analytics if enabled
    if config['enable_analytics'] and config.get('analytics_id'):
        analytics_code = f"""
    <!-- Google Analytics -->
    <script async src="https://www.googletagmanager.com/gtag/js?id={config['analytics_id']}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){{dataLayer.push(arguments);}}
      gtag('js', new Date());
      gtag('config', '{config['analytics_id']}');
    </script>
    """
        html_content = html_content.replace('</head>', f'{analytics_code}</head>')
    
    # Write the built HTML
    output_file = dist_dir / "index.html"
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    print(f"✅ Built HTML: {output_file}")
    return True

def copy_assets(output_dir="dist"):
    """Copy static assets to output directory"""
    print("📁 Copying static assets...")
    
    dist_dir = Path(output_dir)
    
    # Assets to copy
    assets = [
        "manifest.json",
        "sw.js",
        "vis.lottie",
        "BernieChiaravalle_Photo_Circle_Icon_v1.png",
        "BernieChiaravalle_Photo_Circle_Icon_v1.webp",
        "SplitText.min.js",
        "appleicon.png",
        "home_color-281w.webp"
    ]
    
    copied = 0
    for asset in assets:
        asset_path = Path(asset)
        if asset_path.exists():
            shutil.copy2(asset_path, dist_dir)
            copied += 1
        else:
            print(f"⚠️  Asset not found: {asset}")
    
    print(f"✅ Copied {copied} assets")

def update_manifest(config, output_dir="dist"):
    """Update PWA manifest with configuration"""
    print("📱 Updating PWA manifest...")
    
    manifest_path = Path(output_dir) / "manifest.json"
    if not manifest_path.exists():
        print("⚠️  manifest.json not found, skipping")
        return
    
    try:
        with open(manifest_path, 'r') as f:
            manifest = json.load(f)
        
        # Update manifest with config
        manifest['name'] = config['title']
        manifest['short_name'] = "BC Radio"
        manifest['description'] = config['description']
        manifest['start_url'] = "/"
        manifest['scope'] = "/"
        
        with open(manifest_path, 'w') as f:
            json.dump(manifest, f, indent=2)
        
        print("✅ Updated PWA manifest")
    except Exception as e:
        print(f"⚠️  Error updating manifest: {e}")

def create_deployment_info(config, output_dir="dist"):
    """Create deployment information file"""
    deployment_info = {
        "build_time": str(Path().stat().st_mtime),
        "config": config,
        "files": [f.name for f in Path(output_dir).glob("*")]
    }
    
    info_file = Path(output_dir) / "deployment-info.json"
    with open(info_file, 'w') as f:
        json.dump(deployment_info, f, indent=2)
    
    print(f"✅ Created deployment info: {info_file}")

def main():
    """Main build function"""
    parser = argparse.ArgumentParser(description="BC Radio Build Script")
    parser.add_argument('--config', default='build.config.json', help='Configuration file')
    parser.add_argument('--output', default='dist', help='Output directory')
    parser.add_argument('--init', action='store_true', help='Create sample configuration file')
    parser.add_argument('--clean', action='store_true', help='Clean output directory first')
    
    args = parser.parse_args()
    
    if args.init:
        create_build_config(args.config)
        return
    
    print("🏗️  BC Radio Build Script")
    print("=" * 50)
    
    # Clean output directory if requested
    if args.clean:
        output_path = Path(args.output)
        if output_path.exists():
            shutil.rmtree(output_path)
            print(f"🧹 Cleaned {args.output}")
    
    # Load configuration
    config = load_config(args.config)
    print(f"📋 Using configuration: {args.config}")
    print(f"🌐 Stream URL: {config['stream_url']}")
    print(f"📁 Output directory: {args.output}")
    
    # Build steps
    success = True
    
    try:
        # Build HTML
        if not build_html(config, args.output):
            success = False
        
        # Copy assets
        copy_assets(args.output)
        
        # Update manifest
        update_manifest(config, args.output)
        
        # Create deployment info
        create_deployment_info(config, args.output)
        
        if success:
            print("\n🎉 Build completed successfully!")
            print(f"📁 Output: {Path(args.output).absolute()}")
            print(f"🌐 Deploy the '{args.output}' directory to your static hosting")
            print(f"🔗 Stream URL: {config['stream_url']}{config['stream_endpoint']}")
            print(f"🔗 API URL: {config['stream_url']}{config['api_endpoint']}")
        else:
            print("\n❌ Build failed")
            sys.exit(1)
            
    except Exception as e:
        print(f"\n❌ Build error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()