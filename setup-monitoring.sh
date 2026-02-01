#!/bin/bash

# BC Radio Production Monitoring Setup
# Sets up comprehensive monitoring for a professional radio station

set -e

echo "📊 BC Radio Production Monitoring Setup"
echo "======================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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
    if [[ $EUID -ne 0 ]]; then
        print_error "This script must be run as root"
        exit 1
    fi
}

# Install monitoring tools
install_monitoring_tools() {
    print_status "Installing monitoring tools..."
    
    # Update package list
    apt update
    
    # Install monitoring dependencies
    apt install -y \
        docker-compose \
        curl \
        jq \
        htop \
        iotop \
        nethogs \
        python3-pip \
        python3-venv
    
    # Install Python monitoring libraries
    pip3 install \
        requests \
        psutil \
        prometheus_client \
        influxdb \
        grafana-api
    
    print_success "Monitoring tools installed"
}

# Setup Prometheus monitoring
setup_prometheus() {
    print_status "Setting up Prometheus monitoring..."
    
    # Create monitoring directory
    mkdir -p monitoring/{prometheus,grafana,alertmanager}
    
    # Create Prometheus configuration
    cat > monitoring/prometheus/prometheus.yml << 'EOF'
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "alert_rules.yml"

alerting:
  alertmanagers:
    - static_configs:
        - targets:
          - alertmanager:9093

scrape_configs:
  - job_name: 'bc-radio'
    static_configs:
      - targets: ['localhost:8080']  # AzuraCast
    scrape_interval: 30s
    metrics_path: '/api/admin/prometheus'
    
  - job_name: 'node-exporter'
    static_configs:
      - targets: ['localhost:9100']
    scrape_interval: 15s
    
  - job_name: 'caddy'
    static_configs:
      - targets: ['localhost:2019']
    scrape_interval: 30s
    
  - job_name: 'custom-metrics'
    static_configs:
      - targets: ['localhost:8888']
    scrape_interval: 30s
EOF

    # Create alert rules
    cat > monitoring/prometheus/alert_rules.yml << 'EOF'
groups:
  - name: bc-radio-alerts
    rules:
      - alert: StreamDown
        expr: up{job="bc-radio"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "BC Radio stream is down"
          description: "The BC Radio stream has been down for more than 2 minutes"
          
      - alert: HighCPUUsage
        expr: (100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)) > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High CPU usage detected"
          description: "CPU usage is above 80% for more than 5 minutes"
          
      - alert: HighMemoryUsage
        expr: (node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes * 100 > 85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage detected"
          description: "Memory usage is above 85% for more than 5 minutes"
          
      - alert: DiskSpaceLow
        expr: (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100 < 10
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Low disk space"
          description: "Disk space is below 10%"
          
      - alert: StreamQualityIssue
        expr: azuracast_station_listeners < 1
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "No listeners detected"
          description: "Stream has had no listeners for 10+ minutes"
EOF

    print_success "Prometheus configuration created"
}

# Setup Grafana dashboards
setup_grafana() {
    print_status "Setting up Grafana dashboards..."
    
    # Create Grafana configuration
    cat > monitoring/grafana/grafana.ini << 'EOF'
[server]
http_port = 3000
domain = localhost

[security]
admin_user = admin
admin_password = bcradio123

[users]
allow_sign_up = false

[auth.anonymous]
enabled = false

[dashboards]
default_home_dashboard_path = /var/lib/grafana/dashboards/bc-radio-overview.json
EOF

    # Create BC Radio dashboard
    cat > monitoring/grafana/dashboards/bc-radio-overview.json << 'EOF'
{
  "dashboard": {
    "id": null,
    "title": "BC Radio Overview",
    "tags": ["bc-radio"],
    "timezone": "browser",
    "panels": [
      {
        "id": 1,
        "title": "Stream Status",
        "type": "stat",
        "targets": [
          {
            "expr": "up{job=\"bc-radio\"}",
            "refId": "A"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "color": {
              "mode": "thresholds"
            },
            "thresholds": {
              "steps": [
                {"color": "red", "value": 0},
                {"color": "green", "value": 1}
              ]
            }
          }
        },
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 0}
      },
      {
        "id": 2,
        "title": "Current Listeners",
        "type": "stat",
        "targets": [
          {
            "expr": "azuracast_station_listeners",
            "refId": "A"
          }
        ],
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 0}
      },
      {
        "id": 3,
        "title": "CPU Usage",
        "type": "graph",
        "targets": [
          {
            "expr": "100 - (avg(rate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100)",
            "refId": "A"
          }
        ],
        "gridPos": {"h": 8, "w": 24, "x": 0, "y": 8}
      },
      {
        "id": 4,
        "title": "Memory Usage",
        "type": "graph",
        "targets": [
          {
            "expr": "(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes * 100",
            "refId": "A"
          }
        ],
        "gridPos": {"h": 8, "w": 24, "x": 0, "y": 16}
      }
    ],
    "time": {
      "from": "now-1h",
      "to": "now"
    },
    "refresh": "30s"
  }
}
EOF

    print_success "Grafana dashboard created"
}

# Setup custom metrics collector
setup_custom_metrics() {
    print_status "Setting up custom metrics collector..."
    
    cat > bc_radio_metrics.py << 'EOF'
#!/usr/bin/env python3
"""
BC Radio Custom Metrics Collector
Collects custom metrics for BC Radio monitoring.
"""

import time
import requests
import psutil
import json
from prometheus_client import start_http_server, Gauge, Counter, Histogram
from datetime import datetime

# Define metrics
STREAM_LISTENERS = Gauge('bcradio_listeners_total', 'Total number of listeners')
STREAM_BITRATE = Gauge('bcradio_stream_bitrate', 'Current stream bitrate')
SONG_DURATION = Histogram('bcradio_song_duration_seconds', 'Duration of songs played')
SONGS_PLAYED = Counter('bcradio_songs_played_total', 'Total songs played')
STREAM_UPTIME = Gauge('bcradio_uptime_seconds', 'Stream uptime in seconds')

# System metrics
CPU_USAGE = Gauge('bcradio_cpu_usage_percent', 'CPU usage percentage')
MEMORY_USAGE = Gauge('bcradio_memory_usage_percent', 'Memory usage percentage')
DISK_USAGE = Gauge('bcradio_disk_usage_percent', 'Disk usage percentage')

class BCRadioMetrics:
    def __init__(self):
        self.start_time = time.time()
        self.last_song = None
        
    def collect_azuracast_metrics(self):
        """Collect metrics from AzuraCast API"""
        try:
            response = requests.get('http://localhost:8000/api/nowplaying', timeout=5)
            data = response.json()
            
            if 'listeners' in data:
                STREAM_LISTENERS.set(data['listeners']['total'])
            
            if 'now_playing' in data:
                song = data['now_playing']['song']
                
                # Track song changes
                if self.last_song != song.get('id'):
                    SONGS_PLAYED.inc()
                    if song.get('duration'):
                        SONG_DURATION.observe(song['duration'])
                    self.last_song = song.get('id')
                
            # Stream uptime
            STREAM_UPTIME.set(time.time() - self.start_time)
            
        except Exception as e:
            print(f"Error collecting AzuraCast metrics: {e}")
    
    def collect_system_metrics(self):
        """Collect system metrics"""
        try:
            # CPU usage
            cpu_percent = psutil.cpu_percent(interval=1)
            CPU_USAGE.set(cpu_percent)
            
            # Memory usage
            memory = psutil.virtual_memory()
            MEMORY_USAGE.set(memory.percent)
            
            # Disk usage
            disk = psutil.disk_usage('/')
            disk_percent = (disk.used / disk.total) * 100
            DISK_USAGE.set(disk_percent)
            
        except Exception as e:
            print(f"Error collecting system metrics: {e}")
    
    def run(self):
        """Main metrics collection loop"""
        print("Starting BC Radio metrics collector...")
        
        while True:
            self.collect_azuracast_metrics()
            self.collect_system_metrics()
            time.sleep(30)  # Collect every 30 seconds

if __name__ == "__main__":
    # Start HTTP server for Prometheus
    start_http_server(8888)
    
    # Start metrics collection
    collector = BCRadioMetrics()
    collector.run()
EOF

    chmod +x bc_radio_metrics.py
    print_success "Custom metrics collector created"
}

# Setup alerting
setup_alerting() {
    print_status "Setting up alerting..."
    
    # Create Alertmanager configuration
    cat > monitoring/alertmanager/alertmanager.yml << 'EOF'
global:
  smtp_smarthost: 'localhost:587'
  smtp_from: 'alerts@yourdomain.com'

route:
  group_by: ['alertname']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 1h
  receiver: 'web.hook'

receivers:
  - name: 'web.hook'
    email_configs:
      - to: 'admin@yourdomain.com'
        subject: 'BC Radio Alert: {{ .GroupLabels.alertname }}'
        body: |
          {{ range .Alerts }}
          Alert: {{ .Annotations.summary }}
          Description: {{ .Annotations.description }}
          {{ end }}
    
    webhook_configs:
      - url: 'http://localhost:9999/webhook'
        send_resolved: true

inhibit_rules:
  - source_match:
      severity: 'critical'
    target_match:
      severity: 'warning'
    equal: ['alertname', 'dev', 'instance']
EOF

    # Create webhook handler for alerts
    cat > alert_webhook.py << 'EOF'
#!/usr/bin/env python3
"""
BC Radio Alert Webhook Handler
Handles alerts from Alertmanager.
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import subprocess
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class AlertHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        
        try:
            alert_data = json.loads(post_data.decode('utf-8'))
            self.handle_alert(alert_data)
            
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'OK')
            
        except Exception as e:
            logger.error(f"Error handling alert: {e}")
            self.send_response(500)
            self.end_headers()
    
    def handle_alert(self, alert_data):
        """Process incoming alerts"""
        for alert in alert_data.get('alerts', []):
            alert_name = alert.get('labels', {}).get('alertname')
            status = alert.get('status')
            
            logger.info(f"Alert: {alert_name} - Status: {status}")
            
            # Handle specific alerts
            if alert_name == 'StreamDown' and status == 'firing':
                self.restart_stream()
            elif alert_name == 'HighCPUUsage' and status == 'firing':
                self.log_system_info()
    
    def restart_stream(self):
        """Attempt to restart the stream"""
        try:
            logger.info("Attempting to restart AzuraCast...")
            subprocess.run(['docker-compose', 'restart', 'azuracast'], check=True)
            logger.info("AzuraCast restarted successfully")
        except Exception as e:
            logger.error(f"Failed to restart AzuraCast: {e}")
    
    def log_system_info(self):
        """Log system information for debugging"""
        try:
            with open('system_debug.log', 'a') as f:
                f.write(f"\n--- System Debug {datetime.now()} ---\n")
                
                # Log top processes
                result = subprocess.run(['ps', 'aux', '--sort=-pcpu'], 
                                      capture_output=True, text=True)
                f.write("Top CPU processes:\n")
                f.write(result.stdout[:1000])  # First 1000 chars
                
        except Exception as e:
            logger.error(f"Failed to log system info: {e}")

if __name__ == "__main__":
    server = HTTPServer(('localhost', 9999), AlertHandler)
    logger.info("Alert webhook server starting on port 9999...")
    server.serve_forever()
EOF

    chmod +x alert_webhook.py
    print_success "Alerting system configured"
}

# Create monitoring docker-compose
create_monitoring_compose() {
    print_status "Creating monitoring docker-compose..."
    
    cat > monitoring/docker-compose.yml << 'EOF'
version: '3.8'

services:
  prometheus:
    image: prom/prometheus:latest
    container_name: bc-prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus:/etc/prometheus
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.console.libraries=/etc/prometheus/console_libraries'
      - '--web.console.templates=/etc/prometheus/consoles'
      - '--storage.tsdb.retention.time=200h'
      - '--web.enable-lifecycle'
    restart: unless-stopped

  grafana:
    image: grafana/grafana:latest
    container_name: bc-grafana
    ports:
      - "3000:3000"
    volumes:
      - grafana_data:/var/lib/grafana
      - ./grafana/grafana.ini:/etc/grafana/grafana.ini
      - ./grafana/dashboards:/var/lib/grafana/dashboards
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=bcradio123
    restart: unless-stopped

  alertmanager:
    image: prom/alertmanager:latest
    container_name: bc-alertmanager
    ports:
      - "9093:9093"
    volumes:
      - ./alertmanager:/etc/alertmanager
    command:
      - '--config.file=/etc/alertmanager/alertmanager.yml'
      - '--storage.path=/alertmanager'
      - '--web.external-url=http://localhost:9093'
    restart: unless-stopped

  node-exporter:
    image: prom/node-exporter:latest
    container_name: bc-node-exporter
    ports:
      - "9100:9100"
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - '--path.procfs=/host/proc'
      - '--path.rootfs=/rootfs'
      - '--path.sysfs=/host/sys'
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)'
    restart: unless-stopped

volumes:
  prometheus_data:
  grafana_data:
EOF

    print_success "Monitoring docker-compose created"
}

# Create monitoring startup script
create_monitoring_startup() {
    print_status "Creating monitoring startup script..."
    
    cat > start_monitoring.sh << 'EOF'
#!/bin/bash

echo "🚀 Starting BC Radio Monitoring Stack"
echo "====================================="

# Start monitoring containers
cd monitoring
docker-compose up -d

# Wait for services to start
echo "Waiting for services to start..."
sleep 30

# Start custom metrics collector
cd ..
python3 bc_radio_metrics.py &
echo $! > bc_metrics.pid

# Start alert webhook handler
python3 alert_webhook.py &
echo $! > alert_webhook.pid

echo ""
echo "✅ Monitoring stack started!"
echo ""
echo "Access URLs:"
echo "• Grafana: http://localhost:3000 (admin/bcradio123)"
echo "• Prometheus: http://localhost:9090"
echo "• Alertmanager: http://localhost:9093"
echo ""
echo "To stop monitoring:"
echo "bash stop_monitoring.sh"
EOF

    chmod +x start_monitoring.sh
    
    # Create stop script
    cat > stop_monitoring.sh << 'EOF'
#!/bin/bash

echo "🛑 Stopping BC Radio Monitoring Stack"
echo "====================================="

# Stop custom processes
if [ -f bc_metrics.pid ]; then
    kill $(cat bc_metrics.pid) 2>/dev/null || true
    rm bc_metrics.pid
fi

if [ -f alert_webhook.pid ]; then
    kill $(cat alert_webhook.pid) 2>/dev/null || true
    rm alert_webhook.pid
fi

# Stop monitoring containers
cd monitoring
docker-compose down

echo "✅ Monitoring stack stopped!"
EOF

    chmod +x stop_monitoring.sh
    print_success "Monitoring startup scripts created"
}

# Main execution
main() {
    print_status "Setting up BC Radio production monitoring..."
    
    check_root
    install_monitoring_tools
    setup_prometheus
    setup_grafana
    setup_custom_metrics
    setup_alerting
    create_monitoring_compose
    create_monitoring_startup
    
    echo ""
    echo "🎉 BC Radio Monitoring Setup Complete!"
    echo "======================================"
    echo ""
    echo "What was installed:"
    echo "• Prometheus - Metrics collection"
    echo "• Grafana - Dashboards and visualization"
    echo "• Alertmanager - Alert handling"
    echo "• Node Exporter - System metrics"
    echo "• Custom metrics collector - BC Radio specific metrics"
    echo "• Alert webhook handler - Automated responses"
    echo ""
    echo "To start monitoring:"
    echo "bash start_monitoring.sh"
    echo ""
    echo "Access URLs (after starting):"
    echo "• Grafana: http://localhost:3000 (admin/bcradio123)"
    echo "• Prometheus: http://localhost:9090"
    echo "• Alertmanager: http://localhost:9093"
    echo ""
    echo "📊 Your BC Radio now has professional monitoring!"
}

# Run main function
main "$@"