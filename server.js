const express = require('express');
const { Sequelize, DataTypes, Op } = require('sequelize');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const MASTER_KEY = process.env.MASTER_KEY || 'master-key-change-me';

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

// Define ApiKey model
const ApiKey = sequelize.define('ApiKey', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  key: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    index: true
  },
  role: {
    type: DataTypes.ENUM('r', 'w', 'rw'),
    allowNull: false,
    defaultValue: 'rw'
  },
  name: {
    type: DataTypes.STRING,
    allowNull: true
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'api_keys'
});

// Define Metric model
const Metric = sequelize.define('Metric', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  appId: {
    type: DataTypes.STRING,
    allowNull: false,
    index: true
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
      fields: ['appId', 'metric', 'timestamp']
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
  appId: {
    type: DataTypes.STRING,
    allowNull: false,
    index: true
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

// Helper function to generate API keys
function generateApiKey() {
  return 'mk_' + crypto.randomBytes(32).toString('hex');
}

// API Key authentication middleware
const requireAuth = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const appId = req.headers['x-app-id'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing API key' });
  }

  // Check if it's the master key
  if (apiKey === MASTER_KEY) {
    req.auth = {
      isMaster: true,
      appId: appId || null, // Master key can work with or without appId
      role: 'rw'
    };
    return next();
  }

  // For non-master keys, appId is required
  if (!appId) {
    return res.status(400).json({ error: 'Missing X-App-Id header' });
  }

  // Look up API key in database
  try {
    const keyRecord = await ApiKey.findOne({
      where: { key: apiKey, enabled: true }
    });

    if (!keyRecord) {
      return res.status(401).json({ error: 'Invalid or disabled API key' });
    }

    req.auth = {
      isMaster: false,
      appId,
      role: keyRecord.role,
      keyId: keyRecord.id
    };

    next();
  } catch (error) {
    console.error('Error validating API key:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Permission check middleware
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Master key has all permissions
    if (req.auth.isMaster) {
      return next();
    }

    // Check if key has required permission
    const { role } = req.auth;

    if (permission === 'r' && (role === 'r' || role === 'rw')) {
      return next();
    }

    if (permission === 'w' && (role === 'w' || role === 'rw')) {
      return next();
    }

    return res.status(403).json({ error: `Insufficient permissions. Required: ${permission}, Have: ${role}` });
  };
};

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// API Key Management Endpoints (Master Key Only)

// POST /api/keys - Create a new API key
app.post('/api/keys', requireAuth, async (req, res) => {
  if (!req.auth.isMaster) {
    return res.status(403).json({ error: 'Only master key can create API keys' });
  }

  try {
    const { role = 'rw', name } = req.body;

    if (!['r', 'w', 'rw'].includes(role)) {
      return res.status(400).json({ error: 'role must be r, w, or rw' });
    }

    const key = generateApiKey();

    const apiKey = await ApiKey.create({
      key,
      role,
      name,
      enabled: true
    });

    res.json({
      success: true,
      id: apiKey.id,
      key: apiKey.key,
      role: apiKey.role,
      name: apiKey.name
    });
  } catch (error) {
    console.error('Error creating API key:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// GET /api/keys - List all API keys
app.get('/api/keys', requireAuth, async (req, res) => {
  if (!req.auth.isMaster) {
    return res.status(403).json({ error: 'Only master key can list API keys' });
  }

  try {
    const keys = await ApiKey.findAll({
      order: [['createdAt', 'DESC']],
      raw: true
    });

    res.json(keys);
  } catch (error) {
    console.error('Error fetching API keys:', error);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// DELETE /api/keys/:id - Delete an API key
app.delete('/api/keys/:id', requireAuth, async (req, res) => {
  if (!req.auth.isMaster) {
    return res.status(403).json({ error: 'Only master key can delete API keys' });
  }

  try {
    const { id } = req.params;
    const deleted = await ApiKey.destroy({
      where: { id }
    });

    res.json({
      success: true,
      deleted
    });
  } catch (error) {
    console.error('Error deleting API key:', error);
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

// PATCH /api/keys/:id - Update an API key (enable/disable)
app.patch('/api/keys/:id', requireAuth, async (req, res) => {
  if (!req.auth.isMaster) {
    return res.status(403).json({ error: 'Only master key can update API keys' });
  }

  try {
    const { id } = req.params;
    const { enabled, name } = req.body;

    const updates = {};
    if (enabled !== undefined) updates.enabled = enabled;
    if (name !== undefined) updates.name = name;

    await ApiKey.update(updates, {
      where: { id }
    });

    const updated = await ApiKey.findByPk(id);

    res.json({
      success: true,
      key: updated
    });
  } catch (error) {
    console.error('Error updating API key:', error);
    res.status(500).json({ error: 'Failed to update API key' });
  }
});

// Metrics Endpoints

// POST /api/metrics - Submit a metric
app.post('/api/metrics', requireAuth, requirePermission('w'), async (req, res) => {
  try {
    const { metric, value, timestamp } = req.body;

    if (!metric || value === undefined) {
      return res.status(400).json({ error: 'metric and value are required' });
    }

    if (!req.auth.appId) {
      return res.status(400).json({ error: 'X-App-Id header is required' });
    }

    const ts = timestamp || Date.now();

    const newMetric = await Metric.create({
      appId: req.auth.appId,
      metric,
      value: String(value),
      timestamp: ts
    });

    res.json({
      success: true,
      id: newMetric.id,
      appId: req.auth.appId,
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
app.get('/api/metrics', requireAuth, requirePermission('r'), async (req, res) => {
  try {
    if (!req.auth.appId) {
      return res.status(400).json({ error: 'X-App-Id header is required' });
    }

    const where = { appId: req.auth.appId };

    const metrics = await Metric.findAll({
      attributes: [
        'metric',
        [sequelize.fn('COUNT', '*'), 'count'],
        [sequelize.fn('MAX', sequelize.col('timestamp')), 'last_updated']
      ],
      where,
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
app.get('/api/metrics/:name', requireAuth, requirePermission('r'), async (req, res) => {
  try {
    const { name } = req.params;
    const { limit = 100, range } = req.query;

    if (!req.auth.appId) {
      return res.status(400).json({ error: 'X-App-Id header is required' });
    }

    const where = {
      appId: req.auth.appId,
      metric: name
    };

    // Handle time range (e.g., 24h, 7d, 30d)
    if (range) {
      const now = Date.now();
      let ms = 0;

      if (range.endsWith('h')) ms = parseInt(range) * 60 * 60 * 1000;
      else if (range.endsWith('d')) ms = parseInt(range) * 24 * 60 * 60 * 1000;
      else if (range.endsWith('m')) ms = parseInt(range) * 60 * 1000;

      if (ms > 0) {
        where.timestamp = { [Op.gte]: now - ms };
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
      appId: req.auth.appId,
      count: data.length,
      data
    });
  } catch (error) {
    console.error('Error fetching metric data:', error);
    res.status(500).json({ error: 'Failed to fetch metric data' });
  }
});

// DELETE /api/metrics/:name - Delete a metric and all its data
app.delete('/api/metrics/:name', requireAuth, requirePermission('w'), async (req, res) => {
  try {
    const { name } = req.params;

    if (!req.auth.appId) {
      return res.status(400).json({ error: 'X-App-Id header is required' });
    }

    const deleted = await Metric.destroy({
      where: {
        appId: req.auth.appId,
        metric: name
      }
    });

    res.json({
      success: true,
      deleted,
      appId: req.auth.appId,
      metric: name
    });
  } catch (error) {
    console.error('Error deleting metric:', error);
    res.status(500).json({ error: 'Failed to delete metric' });
  }
});

// POST /api/alerts - Create an alert
app.post('/api/alerts', requireAuth, requirePermission('w'), async (req, res) => {
  try {
    const { metric, condition, threshold, webhook, email } = req.body;

    if (!metric || !condition || !threshold) {
      return res.status(400).json({ error: 'metric, condition, and threshold are required' });
    }

    if (!req.auth.appId) {
      return res.status(400).json({ error: 'X-App-Id header is required' });
    }

    const alert = await Alert.create({
      appId: req.auth.appId,
      metric,
      condition,
      threshold: String(threshold),
      webhook: webhook || null,
      email: email || null
    });

    res.json({
      success: true,
      id: alert.id,
      appId: req.auth.appId
    });
  } catch (error) {
    console.error('Error creating alert:', error);
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

// GET /api/alerts - List all alerts
app.get('/api/alerts', requireAuth, requirePermission('r'), async (req, res) => {
  try {
    if (!req.auth.appId) {
      return res.status(400).json({ error: 'X-App-Id header is required' });
    }

    const alerts = await Alert.findAll({
      where: { appId: req.auth.appId },
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
app.get('/api/stats', requireAuth, requirePermission('r'), async (req, res) => {
  try {
    if (!req.auth.appId) {
      return res.status(400).json({ error: 'X-App-Id header is required' });
    }

    const where = { appId: req.auth.appId };

    const totalMetrics = await Metric.count({
      distinct: true,
      col: 'metric',
      where
    });

    const totalDataPoints = await Metric.count({
      where
    });

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
      appId: req.auth.appId,
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
    -H "Content-Type: application/json" \\
    -d '{"metric":"test","value":"42"}'
  `);
});
