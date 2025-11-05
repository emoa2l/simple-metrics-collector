# Metric Collector

> Simple, self-hosted metric aggregator for modern applications. Lightweight alternative to Prometheus and Grafana.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

A lightweight metric collection and visualization tool for monitoring applications, IoT devices, and business KPIs. No complex setup, no Prometheus, no bloat. Just send metrics via HTTP POST and view them in auto-generated dashboards.

**Perfect for:** Application monitoring • IoT sensor data • Business metrics • Self-hosted observability • Prometheus alternative

## Documentation

- [Quick Start](#quick-start) - Get started in 5 minutes
- [Usage Guide](#usage) - API key management, sending metrics, creating alerts
- [API Reference](#api-reference) - Complete REST API documentation
- [Configuration](#configuration) - Environment variables and database setup
- [Deployment](#deployment) - Docker, cloud, and VPS deployment guides
- [GitHub Pages](https://emoa2l.github.io/simple-metrics-collector/) - Project homepage

## Features

- **Simple API** - Just `POST {metric: "name", value: "123"}` to collect metrics
- **Multi-Tenancy** - Partition metrics by App ID for multiple applications
- **Role-Based API Keys** - Read-only, write-only, or read-write access control
- **Smart Alerts** - Consecutive breach/recovery tracking prevents flapping
- **Multi-State Visuals** - Yellow (breaching), Red (alerting), Blue (recovering)
- **Webhook Integrations** - Slack & Discord formatted messages, generic JSON, webhook history tracking
- **Missing Data Detection** - Configurable per-metric to detect crashes/downtime
- **Intelligent Aggregation** - Auto-detects SUM/MAX/AVG based on metric name patterns
- **Aggressive Data Bucketing** - Smart downsampling (30s/2m/10m/1h buckets) for clean charts
- **Gap Detection** - Visualizes data gaps with dotted lines and no fill
- **White-Label Support** - Customize branding, colors, logo, and app name
- **Time-Based Charts** - Uniform x-axis with Chart.js time scale, 1-second granularity
- **URL Authentication** - Share dashboard links with embedded credentials (`?appId=...&apiKey=...`)
- **Interactive Demo** - `./demo.sh` with auto-login links and webhook support
- **Multiple Database Support** - SQLite, PostgreSQL, or MySQL
- **Auto-Generated Dashboards** - Grid view with all metrics, auto-refresh controls
- **Detailed Metric Views** - Click any metric for alert config, webhook history, current state
- **Easy Deployment** - Docker, npm, or standalone
- **No Dependencies** - Works out of the box with SQLite
- **Retention Policies** - Automatic cleanup of old data

## Quick Start

### Docker (Recommended)

```bash
# Clone and run
git clone https://github.com/emoa2l/simple-metrics-collector.git
cd simple-metrics-collector
docker-compose up -d

# Access dashboard at http://localhost:3000
# Default master key: master-key-change-me
```

### npm

```bash
# Install dependencies
npm install

# Start server
npm start

# Access dashboard at http://localhost:3000
```

### From Source

```bash
# Clone
git clone https://github.com/emoa2l/simple-metrics-collector.git
cd simple-metrics-collector

# Install
npm install

# Configure (optional)
cp .env.example .env
# Edit .env with your settings

# Run
npm start
```

## Usage

### API Key Management

First, create API keys using the master key:

```bash
# Create a read-write API key
curl -X POST http://localhost:3000/api/keys \
  -H "X-API-Key: master-key-change-me" \
  -H "Content-Type: application/json" \
  -d '{"role": "rw", "name": "My App Key"}'

# Response:
# {
#   "success": true,
#   "id": 1,
#   "key": "mk_a1b2c3d4...",
#   "role": "rw",
#   "name": "My App Key"
# }

# Create a read-only API key
curl -X POST http://localhost:3000/api/keys \
  -H "X-API-Key: master-key-change-me" \
  -H "Content-Type: application/json" \
  -d '{"role": "r", "name": "Read Only Key"}'

# Create a write-only API key (for sending metrics only)
curl -X POST http://localhost:3000/api/keys \
  -H "X-API-Key: master-key-change-me" \
  -H "Content-Type: application/json" \
  -d '{"role": "w", "name": "Write Only Key"}'

# List all API keys
curl http://localhost:3000/api/keys \
  -H "X-API-Key: master-key-change-me"

# Disable an API key
curl -X PATCH http://localhost:3000/api/keys/1 \
  -H "X-API-Key: master-key-change-me" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'

# Delete an API key
curl -X DELETE http://localhost:3000/api/keys/1 \
  -H "X-API-Key: master-key-change-me"
```

### Sending Metrics

**Important:** All metric operations require both `X-API-Key` and `X-App-Id` headers for multi-tenancy.

```bash
# Basic metric
curl -X POST http://localhost:3000/api/metrics \
  -H "X-API-Key: mk_a1b2c3d4..." \
  -H "X-App-Id: my-app" \
  -H "Content-Type: application/json" \
  -d '{"metric": "cpu_usage", "value": "75"}'

# With custom timestamp
curl -X POST http://localhost:3000/api/metrics \
  -H "X-API-Key: mk_a1b2c3d4..." \
  -H "X-App-Id: my-app" \
  -H "Content-Type: application/json" \
  -d '{"metric": "memory", "value": "4096", "timestamp": 1699999999000}'
```

### Viewing Metrics

```bash
# List all metrics
curl http://localhost:3000/api/metrics \
  -H "X-API-Key: mk_a1b2c3d4..." \
  -H "X-App-Id: my-app"

# Get specific metric data
curl http://localhost:3000/api/metrics/cpu_usage \
  -H "X-API-Key: mk_a1b2c3d4..." \
  -H "X-App-Id: my-app"

# Get data for specific time range
curl "http://localhost:3000/api/metrics/cpu_usage?range=24h&limit=100" \
  -H "X-API-Key: mk_a1b2c3d4..." \
  -H "X-App-Id: my-app"
```

Time ranges: `1h`, `24h`, `7d`, `30d`, or custom in minutes `60m`

### Configuring Webhooks

Before creating alerts, configure webhooks to receive notifications:

```bash
# Create a Slack webhook (auto-formats for Slack)
curl -X POST http://localhost:3000/api/webhooks \
  -H "X-API-Key: mk_a1b2c3d4..." \
  -H "X-App-Id: my-app" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Slack Alerts",
    "url": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL",
    "format": "slack"
  }'

# Create a generic webhook (raw JSON)
curl -X POST http://localhost:3000/api/webhooks \
  -H "X-API-Key: mk_a1b2c3d4..." \
  -H "X-App-Id: my-app" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Generic Webhook",
    "url": "https://your-webhook-url.com/endpoint",
    "format": "generic"
  }'

# List all webhooks
curl http://localhost:3000/api/webhooks \
  -H "X-API-Key: mk_a1b2c3d4..." \
  -H "X-App-Id: my-app"

# Disable a webhook
curl -X PATCH http://localhost:3000/api/webhooks/1 \
  -H "X-API-Key: mk_a1b2c3d4..." \
  -H "X-App-Id: my-app" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'

# Delete a webhook
curl -X DELETE http://localhost:3000/api/webhooks/1 \
  -H "X-API-Key: mk_a1b2c3d4..." \
  -H "X-App-Id: my-app"
```

**Webhook Formats:**
- `slack`: Auto-formatted rich messages for Slack with color-coded attachments
- `discord`: Auto-formatted embeds for Discord with color-coded messages
- `generic`: Raw JSON payload (default)

**Slack/Discord webhooks** send rich formatted messages:
- 🚨 Red for "ALERT TRIGGERED"
- ⚠️ Yellow for "STILL ALERTING"
- ✅ Green for "RECOVERED"

### Creating Alerts

Create threshold-based alerts with smart breach detection:

```bash
# Create a basic alert (default thresholds)
curl -X POST http://localhost:3000/api/alerts \
  -H "X-API-Key: mk_a1b2c3d4..." \
  -H "X-App-Id: my-app" \
  -H "Content-Type: application/json" \
  -d '{
    "metric": "cpu_usage",
    "condition": ">",
    "threshold": "80"
  }'

# Create an alert with custom thresholds
curl -X POST http://localhost:3000/api/alerts \
  -H "X-API-Key: mk_a1b2c3d4..." \
  -H "X-App-Id: my-app" \
  -H "Content-Type: application/json" \
  -d '{
    "metric": "cpu_usage",
    "condition": ">",
    "threshold": "80",
    "enterThreshold": 5,
    "exitThreshold": 3,
    "webhookFrequencyMinutes": 10
  }'

# Create an alert with missing data detection (detects crashes)
curl -X POST http://localhost:3000/api/alerts \
  -H "X-API-Key: mk_a1b2c3d4..." \
  -H "X-App-Id: my-app" \
  -H "Content-Type: application/json" \
  -d '{
    "metric": "cpu_usage",
    "condition": ">",
    "threshold": "80",
    "treatMissingAsBreach": true,
    "expectedIntervalSeconds": 30
  }'

# List all alerts
curl http://localhost:3000/api/alerts \
  -H "X-API-Key: mk_a1b2c3d4..." \
  -H "X-App-Id: my-app"

# Get which metrics are currently alerting
curl http://localhost:3000/api/alert-states \
  -H "X-API-Key: mk_a1b2c3d4..." \
  -H "X-App-Id: my-app"
```

**Alert Parameters:**
- `metric`: Metric name to monitor
- `condition`: Comparison operator (`>`, `<`, `>=`, `<=`, `==`, `!=`)
- `threshold`: Value to compare against
- `enterThreshold`: Number of consecutive breaches before entering alert state (default: 3)
- `exitThreshold`: Number of consecutive recoveries before exiting alert state (default: 3)
- `webhookFrequencyMinutes`: How often to call webhook while in alert state (default: 5)
- `treatMissingAsBreach`: Whether missing data counts as a breach (default: false)
- `expectedIntervalSeconds`: Expected interval between data points (required if treatMissingAsBreach=true)

**How Smart Alerts Work:**
1. Configure one or more webhooks for your app
2. Create alerts with thresholds and conditions
3. System tracks **consecutive** breaches (prevents flapping)
4. When consecutive breaches >= `enterThreshold`, alert enters active state
5. While active, webhooks are called every `webhookFrequencyMinutes`
6. When metric recovers for `exitThreshold` consecutive times, alert exits
7. Dashboard shows multi-state visuals:
   - ⚪ White: Normal
   - 🟡 Yellow: Breaching (1-2 breaches, not yet alerting)
   - 🔴 Red: Alerting (3+ consecutive breaches)
   - 🔵 Blue: Recovering (1-2 recoveries while alerting)

**Missing Data Detection:**
- Enable `treatMissingAsBreach` for critical metrics (CPU, memory)
- Background job checks every 10 seconds for missing data
- If no data received for 2+ intervals, counts as breach
- Useful for detecting crashed applications or network issues
- Sends webhook with `"value": "NO DATA"` and `"reason": "missing_data"`

**Webhook Payload States:**
- `entered`: Alert just entered active state (3rd consecutive breach)
- `active`: Alert is ongoing (repeated notification every N minutes)
- `recovered`: Alert has cleared (3rd consecutive recovery)

### Intelligent Metric Aggregation & Data Bucketing

Metrics are automatically downsampled using **intelligent aggregation** based on metric name patterns and time range:

**Bucket Sizes (for clean charts with ~120-1000 points):**
- **1h view**: 30-second buckets (~120 points)
- **24h view**: 2-minute buckets (~720 points)
- **7d view**: 10-minute buckets (~1,008 points)
- **30d view**: 1-hour buckets (~720 points)

**Aggregation Types:**

**SUM Aggregation** (for throughput/rate metrics):
- `error_rate`, `requests_per_sec`, `*_rate`, `*_per_min`, `*count`, `*total`
- Shows total throughput per time bucket
- Example: `requests_per_sec` with 30s bucket → total requests per 30 seconds

**MAX Aggregation** (for usage/capacity metrics):
- `cpu_usage`, `memory_usage`, `*usage`, `*cpu`, `*memory`, `*disk`, `*load`
- Shows peak usage per time bucket
- Example: `cpu_usage` with 2m bucket → highest CPU spike per 2 minutes

**AVG Aggregation** (for latency/performance metrics):
- `response_time_ms`, `latency_ms`, everything else
- Shows typical performance per time bucket
- Example: `response_time_ms` with 10m bucket → average response time per 10 minutes

The aggregation type is displayed in the metric detail modal with a color-coded badge (∑ SUM=blue, ↑ MAX=red, ⌀ AVG=gray).

### Gap Detection & Visualization

Data gaps (when metrics stop being sent) are automatically detected and visualized:

- **Detection**: If the time between two data points is more than 2.5× the expected interval, it's marked as a gap
- **Visualization**: Gaps are shown as gray dotted lines with no background fill
- **Normal data**: Solid colored lines with shaded background
- **Use case**: Easily spot service outages, network issues, or data collection problems

Example: If you're sending metrics every 30 seconds and suddenly stop for 2 minutes, the chart will show a gray dotted line connecting the last point before the gap to the first point after recovery.

### URL Authentication (Shareable Dashboard Links)

Share dashboard access via URL parameters - perfect for demos, read-only viewers, or embedded dashboards:

```
http://your-server:3000?appId=my-app&apiKey=readonly-key-abc123
```

**Features:**
- Auto-login on page load
- Credentials saved to localStorage for convenience
- Supports both `appId`/`apiKey` and `appid`/`apikey` (case-insensitive)
- Clean authenticated UI shows App ID and masked API key
- "Change Credentials" button to switch accounts

**Demo script integration:**
The `./demo.sh` script now outputs direct dashboard links with auto-login:
```bash
./demo.sh
# Outputs: http://localhost:3001?appId=demo-app-1762369755&apiKey=abc123...
```

## Configuration

Create a `.env` file or set environment variables:

```bash
# Server
PORT=3000
NODE_ENV=production

# Security
MASTER_KEY=your-master-key-change-in-production  # For managing API keys

# Database (choose one)
DATABASE_URL=sqlite://./data/metrics.db                           # SQLite (default)
# DATABASE_URL=postgres://user:pass@localhost:5432/metrics        # PostgreSQL
# DATABASE_URL=mysql://user:pass@localhost:3306/metrics           # MySQL

# Retention
RETENTION_DAYS=30  # Auto-delete data older than 30 days

# White-Label Branding (Optional)
APP_NAME=Acme Metrics
APP_TAGLINE=Real-time Application & Infrastructure Monitoring
PRIMARY_COLOR=#6366f1
LOGO_URL=https://via.placeholder.com/150x40/6366f1/ffffff?text=ACME  # Optional - omit for text-only header
FAVICON_URL=https://via.placeholder.com/32/6366f1/ffffff?text=A      # Optional
FOOTER_TEXT=© 2025 Acme Corporation                                  # Optional

# Note: All branding variables are optional. Missing/broken logo URLs are gracefully handled.
```

### Multi-Tenancy & API Keys

Metric Collector supports multi-tenancy through **App IDs**:

- **App ID** (`X-App-Id` header): Partitions metrics by application
- **Master Key**: Full access, can create/manage API keys, access all apps
- **API Keys**: Three roles for granular access control
  - `r` (read-only): Can view metrics and dashboards
  - `w` (write-only): Can submit metrics only
  - `rw` (read-write): Full access to metrics (default)

**Example Workflow:**
1. Use master key to create an API key for your app
2. Send metrics with the API key + App ID
3. View metrics in dashboard with API key + App ID
4. Each App ID maintains isolated metrics

## Database Support

### SQLite (Default)
No setup required. Data stored in `./data/metrics.db`

```bash
DATABASE_URL=sqlite://./data/metrics.db
```

### PostgreSQL

```bash
# Install PostgreSQL, then:
DATABASE_URL=postgres://username:password@localhost:5432/metrics
```

### MySQL

```bash
# Install MySQL, then:
DATABASE_URL=mysql://username:password@localhost:3306/metrics
```

## API Reference

### POST /api/metrics
Submit a metric

**Request:**
```json
{
  "metric": "metric_name",
  "value": "123",
  "timestamp": 1699999999000  // optional, defaults to now
}
```

**Response:**
```json
{
  "success": true,
  "id": 1,
  "metric": "metric_name",
  "value": "123",
  "timestamp": 1699999999000
}
```

### GET /api/metrics
List all unique metrics

**Response:**
```json
[
  {
    "metric": "cpu_usage",
    "count": 150,
    "last_updated": 1699999999000
  }
]
```

### GET /api/metrics/:name
Get metric history

**Query Parameters:**
- `range` - Time range (1h, 24h, 7d, 30d)
- `limit` - Max data points (default: 100)

### DELETE /api/metrics/:name
Delete a metric and all its data

### POST /api/alerts
Create an alert

### GET /api/alerts
List all alerts

### GET /api/stats
Get overall statistics

## Use Cases

### Fleet Monitoring (Multiple Servers)

**Option 1: Use hostname prefix in metric name** (all servers in same App ID)
```bash
# Server 1
curl -X POST http://your-server/api/metrics \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: production-cluster" \
  -d '{"metric":"web01_cpu_usage","value":"45"}'

curl -X POST http://your-server/api/metrics \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: production-cluster" \
  -d '{"metric":"web01_memory_usage","value":"60"}'

# Server 2
curl -X POST http://your-server/api/metrics \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: production-cluster" \
  -d '{"metric":"web02_cpu_usage","value":"52"}'

curl -X POST http://your-server/api/metrics \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: production-cluster" \
  -d '{"metric":"web02_memory_usage","value":"75"}'

# Dashboard shows: web01_cpu_usage, web01_memory_usage, web02_cpu_usage, web02_memory_usage
```

**Option 2: Use App ID as hostname** (each server gets its own App ID)
```bash
# Server 1
curl -X POST http://your-server/api/metrics \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: web01" \
  -d '{"metric":"cpu_usage","value":"45"}'

curl -X POST http://your-server/api/metrics \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: web01" \
  -d '{"metric":"memory_usage","value":"60"}'

# Server 2
curl -X POST http://your-server/api/metrics \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: web02" \
  -d '{"metric":"cpu_usage","value":"52"}'

# Each server has its own dashboard: ?appId=web01 or ?appId=web02
```

**Recommendation:** Use **Option 1** (hostname prefix) for unified fleet dashboard, or **Option 2** (App ID per server) for isolated server views.

### IoT Sensor Data
```bash
# Temperature sensor
curl -X POST http://your-server/api/metrics \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: home-sensors" \
  -d '{"metric":"temperature","value":"22.5"}'
```

### Application Monitoring
```javascript
// In your Node.js app
async function reportMetric(metric, value) {
  await fetch('http://localhost:3000/api/metrics', {
    method: 'POST',
    headers: {
      'X-API-Key': process.env.METRICS_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ metric, value })
  });
}

// Track API calls
reportMetric('api_calls', 1);

// Track response times
reportMetric('response_time_ms', 145);
```

### Business KPIs
```bash
# Daily signups
curl -X POST http://localhost:3000/api/metrics \
  -H "X-API-Key: $API_KEY" \
  -d '{"metric":"signups","value":"25"}'

# Revenue
curl -X POST http://localhost:3000/api/metrics \
  -H "X-API-Key: $API_KEY" \
  -d '{"metric":"revenue_usd","value":"1250.50"}'
```

## Deployment

### Docker

```bash
docker build -t metric-collector .
docker run -p 3000:3000 \
  -e API_KEY=your-secret-key \
  -v ./data:/app/data \
  metric-collector
```

### Docker Compose

```bash
docker-compose up -d
```

### VPS / Cloud

Works on any platform with Node.js:
- DigitalOcean
- AWS EC2
- Railway
- Fly.io
- Render
- Heroku

### Railway One-Click Deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new)

## Interactive Demo

Run the included demo script to see the alert system in action:

```bash
# Basic demo (with placeholder webhook)
./demo.sh

# Demo with your Slack webhook
./demo.sh https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Demo with Discord webhook
./demo.sh https://discord.com/api/webhooks/YOUR/WEBHOOK/URL
```

The demo script:
- Creates unique App ID and API keys for each run
- **Outputs direct dashboard link with auto-login** - just click to watch!
- Displays credentials upfront if you need to login manually
- Demonstrates the full alert lifecycle with interactive pauses
- Shows consecutive breach tracking (3 breaches → alert)
- Shows recovery tracking (3 recoveries → cleared)
- Sends varied metrics (CPU, memory, error_rate, response_time, requests_per_sec)
- Auto-detects Slack/Discord URLs and formats webhooks accordingly
- Waits 60 seconds or Enter key between steps

**Example output:**
```
📊 Direct Dashboard Link (auto-login):
   http://localhost:3001?appId=demo-app-1762369755&apiKey=abc123...

   Just click the link - no manual login needed!
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode (with auto-reload)
npm run dev

# Run tests (coming soon)
npm test
```

## Roadmap

**Completed:**
- [x] Smart alert thresholds with consecutive breach/recovery tracking
- [x] Webhook notifications (Slack, Discord, generic JSON)
- [x] Multi-tenancy with role-based API keys
- [x] Intelligent metric aggregation (SUM/MAX/AVG based on metric names)
- [x] Multi-state visual indicators (breaching/alerting/recovering)
- [x] Missing data detection for crash detection
- [x] White-label branding support
- [x] Webhook call history tracking
- [x] Interactive demo script

**In Progress:**
- [ ] Data export (CSV, JSON)
- [ ] More visualization options (heatmaps, gauges, sparklines)
- [ ] Grafana data source plugin
- [ ] Email webhook support
- [ ] Alert templates
- [ ] Metric annotations

**Planned:**
- [ ] Client libraries (Python, Go, Ruby, PHP)
- [ ] Metric anomaly detection (ML-based)
- [ ] Downtime tracking
- [ ] SLA monitoring and reporting
- [ ] API rate limiting
- [ ] Metric retention policies per metric type

## Contributing

Contributions welcome! Please open an issue or PR.

## License

MIT

## Support

- 📖 [Documentation](https://emoa2l.github.io/simple-metrics-collector/) - Project homepage and guides
- 🐛 [GitHub Issues](https://github.com/emoa2l/simple-metrics-collector/issues) - Report bugs and request features
- 💬 [GitHub Discussions](https://github.com/emoa2l/simple-metrics-collector/discussions) - Ask questions and share ideas
- 💖 [GitHub Sponsors](https://github.com/sponsors/emoa2l) - Support development

## Keywords

`metrics` `monitoring` `self-hosted` `observability` `prometheus-alternative` `grafana-alternative` `dashboard` `nodejs` `iot` `business-metrics` `application-monitoring` `time-series` `sqlite` `postgresql` `mysql` `docker` `api` `rest-api` `multi-tenancy`

---

Built with ❤️ by [emoa2l](https://github.com/emoa2l)
