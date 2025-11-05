const express = require('express');
const { Sequelize, DataTypes, Op } = require('sequelize');
const path = require('path');
const crypto = require('crypto');
const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');
const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
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
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  lastTriggered: {
    type: DataTypes.BIGINT,
    allowNull: true
  }
}, {
  tableName: 'alerts'
});

// Define AwsConfig model
const AwsConfig = sequelize.define('AwsConfig', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  appId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    index: true
  },
  roleArn: {
    type: DataTypes.STRING,
    allowNull: false
  },
  region: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'us-east-1'
  },
  externalId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'aws_configs'
});

// Define WebhookConfig model
const WebhookConfig = sequelize.define('WebhookConfig', {
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
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  url: {
    type: DataTypes.STRING,
    allowNull: false
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'webhook_configs'
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

// Helper function to assume AWS role and get credentials
async function assumeRole(appId) {
  try {
    const config = await AwsConfig.findOne({
      where: { appId, enabled: true }
    });

    if (!config) {
      throw new Error('AWS configuration not found for this app');
    }

    const stsClient = new STSClient({ region: config.region });

    const params = {
      RoleArn: config.roleArn,
      RoleSessionName: `metric-collector-${appId}-${Date.now()}`,
      DurationSeconds: 3600 // 1 hour
    };

    if (config.externalId) {
      params.ExternalId = config.externalId;
    }

    const command = new AssumeRoleCommand(params);
    const response = await stsClient.send(command);

    return {
      accessKeyId: response.Credentials.AccessKeyId,
      secretAccessKey: response.Credentials.SecretAccessKey,
      sessionToken: response.Credentials.SessionToken,
      region: config.region
    };
  } catch (error) {
    console.error('Error assuming AWS role:', error);
    throw error;
  }
}

// Helper function to get AWS clients with assumed role credentials
async function getAwsClients(appId) {
  const credentials = await assumeRole(appId);

  const config = {
    region: credentials.region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken
    }
  };

  return {
    cloudwatch: new CloudWatchClient(config),
    sns: new SNSClient(config)
  };
}

// Helper function to check if value meets alert condition
function checkAlertCondition(value, condition, threshold) {
  const numValue = parseFloat(value);
  const numThreshold = parseFloat(threshold);

  if (isNaN(numValue) || isNaN(numThreshold)) {
    return false;
  }

  switch (condition) {
    case '>':
      return numValue > numThreshold;
    case '<':
      return numValue < numThreshold;
    case '>=':
      return numValue >= numThreshold;
    case '<=':
      return numValue <= numThreshold;
    case '==':
      return numValue === numThreshold;
    case '!=':
      return numValue !== numThreshold;
    default:
      return false;
  }
}

// Helper function to call webhook
async function callWebhook(url, payload) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Metric-Collector/1.0'
      },
      body: JSON.stringify(payload),
      timeout: 5000
    });

    return {
      success: response.ok,
      status: response.status
    };
  } catch (error) {
    console.error('Error calling webhook:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Helper function to check and trigger alerts for a metric
async function checkAndTriggerAlerts(appId, metricName, value, timestamp) {
  try {
    // Find all enabled alerts for this metric and app
    const alerts = await Alert.findAll({
      where: {
        appId,
        metric: metricName,
        enabled: true
      }
    });

    if (alerts.length === 0) {
      return;
    }

    // Get all enabled webhooks for this app
    const webhooks = await WebhookConfig.findAll({
      where: {
        appId,
        enabled: true
      }
    });

    if (webhooks.length === 0) {
      console.log(`No webhooks configured for appId: ${appId}`);
      return;
    }

    // Check each alert
    for (const alert of alerts) {
      const triggered = checkAlertCondition(value, alert.condition, alert.threshold);

      if (triggered) {
        console.log(`Alert triggered: ${metricName} ${alert.condition} ${alert.threshold} (value: ${value})`);

        // Update lastTriggered
        await Alert.update(
          { lastTriggered: timestamp },
          { where: { id: alert.id } }
        );

        // Call all enabled webhooks
        const payload = {
          appId,
          alert: {
            id: alert.id,
            metric: metricName,
            condition: alert.condition,
            threshold: alert.threshold
          },
          value,
          timestamp,
          triggeredAt: new Date(timestamp).toISOString()
        };

        for (const webhook of webhooks) {
          console.log(`Calling webhook: ${webhook.name} (${webhook.url})`);
          await callWebhook(webhook.url, payload);
        }
      }
    }
  } catch (error) {
    console.error('Error checking alerts:', error);
  }
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

// AWS Configuration Endpoints

// POST /api/aws/config - Configure AWS integration
app.post('/api/aws/config', requireAuth, async (req, res) => {
  try {
    if (!req.auth.appId) {
      return res.status(400).json({ error: 'X-App-Id header is required' });
    }

    const { roleArn, region = 'us-east-1', externalId } = req.body;

    if (!roleArn) {
      return res.status(400).json({ error: 'roleArn is required' });
    }

    // Validate role ARN format
    if (!roleArn.startsWith('arn:aws:iam::')) {
      return res.status(400).json({ error: 'Invalid role ARN format' });
    }

    // Upsert (update if exists, create if not)
    const [config, created] = await AwsConfig.upsert({
      appId: req.auth.appId,
      roleArn,
      region,
      externalId: externalId || null,
      enabled: true
    }, {
      returning: true
    });

    res.json({
      success: true,
      created,
      config: {
        id: config.id,
        appId: config.appId,
        roleArn: config.roleArn,
        region: config.region,
        externalId: config.externalId ? '***' : null,
        enabled: config.enabled
      }
    });
  } catch (error) {
    console.error('Error configuring AWS:', error);
    res.status(500).json({ error: 'Failed to configure AWS integration' });
  }
});

// GET /api/aws/config - Get AWS configuration
app.get('/api/aws/config', requireAuth, requirePermission('r'), async (req, res) => {
  try {
    if (!req.auth.appId) {
      return res.status(400).json({ error: 'X-App-Id header is required' });
    }

    const config = await AwsConfig.findOne({
      where: { appId: req.auth.appId }
    });

    if (!config) {
      return res.status(404).json({ error: 'AWS configuration not found' });
    }

    res.json({
      id: config.id,
      appId: config.appId,
      roleArn: config.roleArn,
      region: config.region,
      externalId: config.externalId ? '***' : null, // Masked for security
      enabled: config.enabled
    });
  } catch (error) {
    console.error('Error fetching AWS config:', error);
    res.status(500).json({ error: 'Failed to fetch AWS configuration' });
  }
});

// DELETE /api/aws/config - Delete AWS configuration
app.delete('/api/aws/config', requireAuth, async (req, res) => {
  try {
    if (!req.auth.appId) {
      return res.status(400).json({ error: 'X-App-Id header is required' });
    }

    const deleted = await AwsConfig.destroy({
      where: { appId: req.auth.appId }
    });

    res.json({
      success: true,
      deleted: deleted > 0
    });
  } catch (error) {
    console.error('Error deleting AWS config:', error);
    res.status(500).json({ error: 'Failed to delete AWS configuration' });
  }
});

// POST /api/aws/test - Test AWS assume role
app.post('/api/aws/test', requireAuth, requirePermission('r'), async (req, res) => {
  try {
    if (!req.auth.appId) {
      return res.status(400).json({ error: 'X-App-Id header is required' });
    }

    // Try to assume the role
    const credentials = await assumeRole(req.auth.appId);

    res.json({
      success: true,
      message: 'Successfully assumed AWS role',
      region: credentials.region,
      sessionExpires: new Date(Date.now() + 3600000).toISOString()
    });
  } catch (error) {
    console.error('Error testing AWS role:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Webhook Configuration Endpoints

// POST /api/webhooks - Create a webhook configuration
app.post('/api/webhooks', requireAuth, requirePermission('w'), async (req, res) => {
  try {
    if (!req.auth.appId) {
      return res.status(400).json({ error: 'X-App-Id header is required' });
    }

    const { name, url } = req.body;

    if (!name || !url) {
      return res.status(400).json({ error: 'name and url are required' });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const webhook = await WebhookConfig.create({
      appId: req.auth.appId,
      name,
      url,
      enabled: true
    });

    res.json({
      success: true,
      webhook
    });
  } catch (error) {
    console.error('Error creating webhook:', error);
    res.status(500).json({ error: 'Failed to create webhook' });
  }
});

// GET /api/webhooks - List all webhooks
app.get('/api/webhooks', requireAuth, requirePermission('r'), async (req, res) => {
  try {
    if (!req.auth.appId) {
      return res.status(400).json({ error: 'X-App-Id header is required' });
    }

    const webhooks = await WebhookConfig.findAll({
      where: { appId: req.auth.appId },
      order: [['createdAt', 'DESC']],
      raw: true
    });

    res.json(webhooks);
  } catch (error) {
    console.error('Error fetching webhooks:', error);
    res.status(500).json({ error: 'Failed to fetch webhooks' });
  }
});

// PATCH /api/webhooks/:id - Update webhook (enable/disable)
app.patch('/api/webhooks/:id', requireAuth, requirePermission('w'), async (req, res) => {
  try {
    if (!req.auth.appId) {
      return res.status(400).json({ error: 'X-App-Id header is required' });
    }

    const { id } = req.params;
    const { enabled, name, url } = req.body;

    const updates = {};
    if (enabled !== undefined) updates.enabled = enabled;
    if (name !== undefined) updates.name = name;
    if (url !== undefined) {
      try {
        new URL(url);
        updates.url = url;
      } catch (e) {
        return res.status(400).json({ error: 'Invalid URL format' });
      }
    }

    await WebhookConfig.update(updates, {
      where: { id, appId: req.auth.appId }
    });

    const updated = await WebhookConfig.findOne({
      where: { id, appId: req.auth.appId }
    });

    res.json({
      success: true,
      webhook: updated
    });
  } catch (error) {
    console.error('Error updating webhook:', error);
    res.status(500).json({ error: 'Failed to update webhook' });
  }
});

// DELETE /api/webhooks/:id - Delete a webhook
app.delete('/api/webhooks/:id', requireAuth, requirePermission('w'), async (req, res) => {
  try {
    if (!req.auth.appId) {
      return res.status(400).json({ error: 'X-App-Id header is required' });
    }

    const { id } = req.params;

    const deleted = await WebhookConfig.destroy({
      where: { id, appId: req.auth.appId }
    });

    res.json({
      success: true,
      deleted: deleted > 0
    });
  } catch (error) {
    console.error('Error deleting webhook:', error);
    res.status(500).json({ error: 'Failed to delete webhook' });
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

    // Check and trigger alerts (non-blocking)
    checkAndTriggerAlerts(req.auth.appId, metric, value, ts).catch(err => {
      console.error('Error in alert checking:', err);
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
    const { metric, condition, threshold } = req.body;

    if (!metric || !condition || !threshold) {
      return res.status(400).json({ error: 'metric, condition, and threshold are required' });
    }

    if (!req.auth.appId) {
      return res.status(400).json({ error: 'X-App-Id header is required' });
    }

    // Validate condition
    if (!['>', '<', '>=', '<=', '==', '!='].includes(condition)) {
      return res.status(400).json({ error: 'condition must be one of: >, <, >=, <=, ==, !=' });
    }

    const alert = await Alert.create({
      appId: req.auth.appId,
      metric,
      condition,
      threshold: String(threshold)
    });

    res.json({
      success: true,
      id: alert.id,
      appId: req.auth.appId,
      alert
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
║   Running on http://localhost:${PORT}        ║
║                                           ║
║   Master Key: ${MASTER_KEY.substring(0, 10)}...               ║
║   Database: ${databaseUrl}    ║
╚═══════════════════════════════════════════╝

Quick Start:
  # Create an API key
  curl -X POST http://localhost:${PORT}/api/keys \\
    -H "X-API-Key: ${MASTER_KEY}" \\
    -H "Content-Type: application/json" \\
    -d '{"role":"rw","name":"My App"}'

  # Send metrics (use the key from above)
  curl -X POST http://localhost:${PORT}/api/metrics \\
    -H "X-API-Key: <your-api-key>" \\
    -H "X-App-Id: my-app" \\
    -H "Content-Type: application/json" \\
    -d '{"metric":"test","value":"42"}'
  `);
});
