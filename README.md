# Metric Collector

> Simple, self-hosted metric aggregator - just POST metrics and view dashboards

A lightweight, easy-to-deploy metric collection and visualization tool. No complex setup, no Prometheus, no bloat. Just send metrics via HTTP POST and view them in a clean dashboard.

## Features

- **Simple API** - Just `POST {metric: "name", value: "123"}` to collect metrics
- **Multiple Database Support** - SQLite, PostgreSQL, or MySQL
- **Clean Dashboard** - View metrics, charts, and trends
- **Alerts** - Set thresholds and get notified
- **Easy Deployment** - Docker, npm, or standalone
- **No Dependencies** - Works out of the box with SQLite
- **Retention Policies** - Automatic cleanup of old data

## Quick Start

### Docker (Recommended)

```bash
# Clone and run
git clone https://github.com/emoa2l/metric-collector.git
cd metric-collector
docker-compose up -d

# Access dashboard at http://localhost:3000
# Default API key: change-me-in-production
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
git clone https://github.com/emoa2l/metric-collector.git
cd metric-collector

# Install
npm install

# Configure (optional)
cp .env.example .env
# Edit .env with your settings

# Run
npm start
```

## Usage

### Sending Metrics

```bash
# Basic metric
curl -X POST http://localhost:3000/api/metrics \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"metric": "cpu_usage", "value": "75"}'

# With custom timestamp
curl -X POST http://localhost:3000/api/metrics \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"metric": "memory", "value": "4096", "timestamp": 1699999999000}'
```

### Viewing Metrics

```bash
# List all metrics
curl http://localhost:3000/api/metrics \
  -H "X-API-Key: your-api-key"

# Get specific metric data
curl http://localhost:3000/api/metrics/cpu_usage \
  -H "X-API-Key: your-api-key"

# Get data for specific time range
curl "http://localhost:3000/api/metrics/cpu_usage?range=24h&limit=100" \
  -H "X-API-Key: your-api-key"
```

Time ranges: `1h`, `24h`, `7d`, `30d`, or custom in minutes `60m`

### Creating Alerts

```bash
curl -X POST http://localhost:3000/api/alerts \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "metric": "cpu_usage",
    "condition": ">",
    "threshold": "80",
    "webhook": "https://hooks.slack.com/..."
  }'
```

## Configuration

Create a `.env` file or set environment variables:

```bash
# Server
PORT=3000
NODE_ENV=production

# Security
API_KEY=your-secret-key-here

# Database (choose one)
DATABASE_URL=sqlite://./data/metrics.db                           # SQLite (default)
# DATABASE_URL=postgres://user:pass@localhost:5432/metrics        # PostgreSQL
# DATABASE_URL=mysql://user:pass@localhost:3306/metrics           # MySQL

# Retention
RETENTION_DAYS=30  # Auto-delete data older than 30 days
```

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

- GitHub Issues: [Report bugs](https://github.com/emoa2l/metric-collector/issues)
- GitHub Sponsors: [Support development](https://github.com/sponsors/emoa2l)

---

Built with ❤️ by [emoa2l](https://github.com/emoa2l)
