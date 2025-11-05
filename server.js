const express = require('express');
const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'default-key-change-me';

// Initialize Sequelize with support for multiple databases
// DATABASE_URL format examples:
//   sqlite://./data/metrics.db (default)
//   postgres://user:pass@localhost:5432/metrics
//   mysql://user:pass@localhost:3306/metrics
const databaseUrl = process.env.DATABASE_URL || 'sqlite://./data/metrics.db';

const sequelize = new Sequelize(databaseUrl, {
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  dialectOptions: databaseUrl.startsWith('sqlite') ? {
    // SQLite specific options
  } : {}
});

// Define Metric model
const Metric = sequelize.define('Metric', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  metric: {
    type: DataTypes.STRING,
    allowNull: false,
    index: true
  },
  value: {
    type: DataTypes.STRING,
    allowNull: false
  },
  timestamp: {
    type: DataTypes.BIGINT,
    allowNull: false,
    index: true
  }
}, {
  tableName: 'metrics',
  indexes: [
    {
      fields: ['metric', 'timestamp']
    }
  ]
});

// Define Alert model
const Alert = sequelize.define('Alert', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  metric: {
    type: DataTypes.STRING,
    allowNull: false
  },
  condition: {
    type: DataTypes.STRING,
    allowNull: false
  },
  threshold: {
    type: DataTypes.STRING,
    allowNull: false
  },
  webhook: {
    type: DataTypes.STRING,
    allowNull: true
  },
  email: {
    type: DataTypes.STRING,
    allowNull: true
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'alerts'
});

// Initialize database
(async () => {
  try {
    await sequelize.authenticate();
    console.log('Database connection established successfully.');
    await sequelize.sync();
    console.log('Database synced successfully.');
  } catch (error) {
    console.error('Unable to connect to the database:', error);
    process.exit(1);
  }
})();

// Middleware
app.use(express.json());
app.use(express.static('public'));

// API Key authentication middleware
const requireAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  next();
};

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// POST /api/metrics - Submit a metric
app.post('/api/metrics', requireAuth, async (req, res) => {
  try {
    const { metric, value, timestamp } = req.body;

    if (!metric || value === undefined) {
      return res.status(400).json({ error: 'metric and value are required' });
    }

    const ts = timestamp || Date.now();

    const newMetric = await Metric.create({
      metric,
      value: String(value),
      timestamp: ts
    });

    res.json({
      success: true,
      id: newMetric.id,
      metric,
      value,
      timestamp: ts
    });
  } catch (error) {
    console.error('Error inserting metric:', error);
    res.status(500).json({ error: 'Failed to insert metric' });
  }
});

// GET /api/metrics - List all unique metrics
app.get('/api/metrics', requireAuth, async (req, res) => {
  try {
    const metrics = await Metric.findAll({
      attributes: [
        'metric',
        [sequelize.fn('COUNT', '*'), 'count'],
        [sequelize.fn('MAX', sequelize.col('timestamp')), 'last_updated']
      ],
      group: ['metric'],
      order: [[sequelize.fn('MAX', sequelize.col('timestamp')), 'DESC']],
      raw: true
    });

    res.json(metrics);
  } catch (error) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

// GET /api/metrics/:name - Get specific metric history
app.get('/api/metrics/:name', requireAuth, async (req, res) => {
  try {
    const { name } = req.params;
    const { limit = 100, range } = req.query;

    const where = { metric: name };

    // Handle time range (e.g., 24h, 7d, 30d)
    if (range) {
      const now = Date.now();
      let ms = 0;

      if (range.endsWith('h')) ms = parseInt(range) * 60 * 60 * 1000;
      else if (range.endsWith('d')) ms = parseInt(range) * 24 * 60 * 60 * 1000;
      else if (range.endsWith('m')) ms = parseInt(range) * 60 * 1000;

      if (ms > 0) {
        where.timestamp = { [sequelize.Sequelize.Op.gte]: now - ms };
      }
    }

    const data = await Metric.findAll({
      where,
      order: [['timestamp', 'ASC']],
      limit: parseInt(limit),
      raw: true
    });

    res.json({
      metric: name,
      count: data.length,
      data
    });
  } catch (error) {
    console.error('Error fetching metric data:', error);
    res.status(500).json({ error: 'Failed to fetch metric data' });
  }
});

// DELETE /api/metrics/:name - Delete a metric and all its data
app.delete('/api/metrics/:name', requireAuth, async (req, res) => {
  try {
    const { name } = req.params;
    const deleted = await Metric.destroy({
      where: { metric: name }
    });

    res.json({
      success: true,
      deleted,
      metric: name
    });
  } catch (error) {
    console.error('Error deleting metric:', error);
    res.status(500).json({ error: 'Failed to delete metric' });
  }
});

// POST /api/alerts - Create an alert
app.post('/api/alerts', requireAuth, async (req, res) => {
  try {
    const { metric, condition, threshold, webhook, email } = req.body;

    if (!metric || !condition || !threshold) {
      return res.status(400).json({ error: 'metric, condition, and threshold are required' });
    }

    const alert = await Alert.create({
      metric,
      condition,
      threshold: String(threshold),
      webhook: webhook || null,
      email: email || null
    });

    res.json({
      success: true,
      id: alert.id
    });
  } catch (error) {
    console.error('Error creating alert:', error);
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

// GET /api/alerts - List all alerts
app.get('/api/alerts', requireAuth, async (req, res) => {
  try {
    const alerts = await Alert.findAll({
      order: [['createdAt', 'DESC']],
      raw: true
    });
    res.json(alerts);
  } catch (error) {
    console.error('Error fetching alerts:', error);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// GET /api/stats - Get overall statistics
app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const totalMetrics = await Metric.count({
      distinct: true,
      col: 'metric'
    });

    const totalDataPoints = await Metric.count();

    // Database size (only works for SQLite)
    let dbSize = 0;
    if (databaseUrl.startsWith('sqlite')) {
      const fs = require('fs');
      const dbPath = databaseUrl.replace('sqlite://', '');
      try {
        const stats = fs.statSync(dbPath);
        dbSize = stats.size;
      } catch (e) {
        // File doesn't exist yet
      }
    }

    res.json({
      totalMetrics,
      totalDataPoints,
      databaseSize: dbSize,
      uptime: process.uptime()
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Cleanup old data (retention policy)
const cleanupOldData = async () => {
  const retentionDays = parseInt(process.env.RETENTION_DAYS || 30);
  const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

  try {
    const deleted = await Metric.destroy({
      where: {
        timestamp: {
          [sequelize.Sequelize.Op.lt]: cutoff
        }
      }
    });

    if (deleted > 0) {
      console.log(`Cleaned up ${deleted} old metrics`);
    }
  } catch (error) {
    console.error('Error cleaning up old data:', error);
  }
};

// Run cleanup daily
setInterval(cleanupOldData, 24 * 60 * 60 * 1000);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  await sequelize.close();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║   Metric Collector Server                 ║
║   Running on http://localhost:${PORT}       ║
║                                           ║
║   API Key: ${API_KEY.substring(0, 10)}...              ║
║   Database: ${process.env.DB_PATH || './data/metrics.db'}   ║
╚═══════════════════════════════════════════╝

Quick Start:
  curl -X POST http://localhost:${PORT}/api/metrics \\
    -H "X-API-Key: ${API_KEY}" \\
    -d '{"metric":"test","value":"42"}'
  `);
});
