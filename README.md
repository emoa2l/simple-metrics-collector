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
- **Multiple Database Support** - SQLite, PostgreSQL, or MySQL
- **Auto-Generated Dashboards** - Grid view with all metrics displayed at once
- **Alerts** - Set thresholds and get notified
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
# Create a webhook
curl -X POST http://localhost:3000/api/webhooks \
  -H "X-API-Key: mk_a1b2c3d4..." \
  -H "X-App-Id: my-app" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Slack Alerts",
    "url": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
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

### Creating Alerts

Create threshold-based alerts that trigger configured webhooks:

```bash
# Create an alert
curl -X POST http://localhost:3000/api/alerts \
  -H "X-API-Key: mk_a1b2c3d4..." \
  -H "X-App-Id: my-app" \
  -H "Content-Type: application/json" \
  -d '{
    "metric": "cpu_usage",
    "condition": ">",
    "threshold": "80"
  }'

# List all alerts
curl http://localhost:3000/api/alerts \
  -H "X-API-Key: mk_a1b2c3d4..." \
  -H "X-App-Id: my-app"
```

**How it works:**
1. Configure one or more webhooks for your app
2. Create alerts with metric name, condition (`>`, `<`, `>=`, `<=`, `==`, `!=`), and threshold
3. When a metric value meets the alert condition, all enabled webhooks are called
4. Webhook receives JSON payload with alert details, value, and timestamp

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

### IoT Sensor Data
```bash
# Temperature sensor
curl -X POST http://your-server/api/metrics \
  -H "X-API-Key: $API_KEY" \
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

- [ ] More visualization options (heatmaps, gauges)
- [ ] Alert notifications (Slack, Discord, Email)
- [ ] User authentication and multi-tenancy
- [ ] Data export (CSV, JSON)
- [ ] Metric aggregation (avg, min, max, sum)
- [ ] Grafana data source plugin
- [ ] Client libraries (Python, Go, Ruby)

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
