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

// White-label / Branding configuration
const BRANDING = {
  appName: process.env.APP_NAME || 'Metric Collector',
  appTagline: process.env.APP_TAGLINE || 'Simple Metrics Dashboard',
  primaryColor: process.env.PRIMARY_COLOR || '#007bff',
  logoUrl: process.env.LOGO_URL || null,
  faviconUrl: process.env.FAVICON_URL || null,
  footerText: process.env.FOOTER_TEXT || null
};

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
  enterThreshold: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 3,
    comment: 'Number of consecutive breaches before entering alert state'
  },
  exitThreshold: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 3,
    comment: 'Number of consecutive recoveries before exiting alert state'
  },
  webhookFrequencyMinutes: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 5,
    comment: 'Minutes between webhook calls while in alert state'
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  consecutiveBreaches: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Current count of consecutive breaches'
  },
  consecutiveRecoveries: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Current count of consecutive recoveries'
  },
  isAlerting: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'Whether alert is currently active'
  },
  lastTriggered: {
    type: DataTypes.BIGINT,
    allowNull: true,
    comment: 'Timestamp when webhook was last called'
  },
  treatMissingAsBreach: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'Whether missing data points should be treated as breaches'
  },
  expectedIntervalSeconds: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Expected interval between data points in seconds (for missing data detection)'
  },
  lastDataTimestamp: {
    type: DataTypes.BIGINT,
    allowNull: true,
    comment: 'Timestamp of last received data point'
  }
}, {
  tableName: 'alerts'
});

// Define WebhookCallHistory model
const WebhookCallHistory = sequelize.define('WebhookCallHistory', {
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
  alertId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    index: true
  },
  webhookId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  webhookUrl: {
    type: DataTypes.STRING,
    allowNull: false
  },
  state: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'entered, active, or recovered'
  },
  success: {
    type: DataTypes.BOOLEAN,
    allowNull: false
  },
  statusCode: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  errorMessage: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  timestamp: {
    type: DataTypes.BIGINT,
    allowNull: false,
    index: true
  }
}, {
  tableName: 'webhook_call_history',
  indexes: [
    {
      fields: ['appId', 'metric']
    }
  ]
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
  },
  format: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'generic',
    comment: 'Webhook payload format: generic or slack'
  }
}, {
  tableName: 'webhook_configs'
});

// Initialize database
(async () => {
  try {
    await sequelize.authenticate();
    console.log('Database connection established successfully.');
    await sequelize.sync({ alter: true });
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

// Helper function to determine aggregation type based on metric name
function getAggregationType(metricName) {
  const name = metricName.toLowerCase();

  // SUM aggregation for rates and throughput metrics
  if (name.includes('_rate') ||
      name.includes('_per_sec') ||
      name.includes('_per_min') ||
      name.includes('requests') ||
      name.includes('count') ||
      name.includes('total')) {
    return 'sum';
  }

  // MAX aggregation for usage and capacity metrics
  if (name.includes('usage') ||
      name.includes('cpu') ||
      name.includes('memory') ||
      name.includes('mem') ||
      name.includes('disk') ||
      name.includes('load')) {
    return 'max';
  }

  // AVG for everything else (latency, response times, etc.)
  return 'avg';
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

// Helper function to format payload for different webhook types
function formatWebhookPayload(payload, format) {
  if (format === 'discord') {
    const { appId, alert, value, state, consecutiveBreaches, consecutiveRecoveries, triggeredAt } = payload;

    // Determine emoji and color based on state
    let emoji = '📊';
    let color = 3066993; // green (decimal)
    let stateText = state.toUpperCase();

    if (state === 'entered') {
      emoji = '🚨';
      color = 15158332; // red
      stateText = 'ALERT TRIGGERED';
    } else if (state === 'active') {
      emoji = '⚠️';
      color = 16776960; // yellow
      stateText = 'STILL ALERTING';
    } else if (state === 'recovered') {
      emoji = '✅';
      color = 3066993; // green
      stateText = 'RECOVERED';
    }

    const fields = [
      {
        name: 'Metric',
        value: alert.metric,
        inline: true
      },
      {
        name: 'Condition',
        value: `${alert.condition} ${alert.threshold}`,
        inline: true
      },
      {
        name: 'Current Value',
        value: value.toString(),
        inline: true
      },
      {
        name: 'App ID',
        value: appId,
        inline: true
      }
    ];

    if (consecutiveBreaches) {
      fields.push({
        name: 'Consecutive Breaches',
        value: consecutiveBreaches.toString(),
        inline: true
      });
    }

    if (consecutiveRecoveries) {
      fields.push({
        name: 'Consecutive Recoveries',
        value: consecutiveRecoveries.toString(),
        inline: true
      });
    }

    return {
      embeds: [{
        title: `${emoji} ${stateText}`,
        color: color,
        fields: fields,
        footer: {
          text: 'Metric Collector'
        },
        timestamp: triggeredAt
      }]
    };
  }

  if (format === 'slack') {
    const { appId, alert, value, state, consecutiveBreaches, consecutiveRecoveries, triggeredAt } = payload;

    // Determine emoji and color based on state
    let emoji = '📊';
    let color = '#36a64f'; // green
    let stateText = state.toUpperCase();

    if (state === 'entered') {
      emoji = '🚨';
      color = 'danger'; // red
      stateText = 'ALERT TRIGGERED';
    } else if (state === 'active') {
      emoji = '⚠️';
      color = 'warning'; // yellow/orange
      stateText = 'STILL ALERTING';
    } else if (state === 'recovered') {
      emoji = '✅';
      color = 'good'; // green
      stateText = 'RECOVERED';
    }

    // Build a simple text message
    let message = `${emoji} *${stateText}*\n\n`;
    message += `*Metric:* ${alert.metric}\n`;
    message += `*Condition:* ${alert.condition} ${alert.threshold}\n`;
    message += `*Current Value:* ${value}\n`;
    message += `*App ID:* ${appId}\n`;

    if (consecutiveBreaches) {
      message += `*Consecutive Breaches:* ${consecutiveBreaches}\n`;
    }

    if (consecutiveRecoveries) {
      message += `*Consecutive Recoveries:* ${consecutiveRecoveries}\n`;
    }

    return {
      text: message,
      attachments: [{
        color: color,
        footer: 'Metric Collector',
        ts: Math.floor(new Date(triggeredAt).getTime() / 1000)
      }]
    };
  }

  // Default: return generic format (original payload)
  return payload;
}

// Helper function to call webhook and record history
async function callWebhook(url, payload, historyData = null, format = 'generic') {
  try {
    // Format the payload based on webhook format
    const formattedPayload = formatWebhookPayload(payload, format);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Metric-Collector/1.0'
      },
      body: JSON.stringify(formattedPayload),
      timeout: 5000
    });

    const result = {
      success: response.ok,
      status: response.status
    };

    // Record history if provided
    if (historyData) {
      await WebhookCallHistory.create({
        appId: historyData.appId,
        metric: historyData.metric,
        alertId: historyData.alertId,
        webhookId: historyData.webhookId,
        webhookUrl: url,
        state: historyData.state,
        success: response.ok,
        statusCode: response.status,
        errorMessage: null,
        timestamp: Math.floor(Date.now() / 1000)
      });
    }

    return result;
  } catch (error) {
    console.error('Error calling webhook:', error);

    // Record failed call history if provided
    if (historyData) {
      await WebhookCallHistory.create({
        appId: historyData.appId,
        metric: historyData.metric,
        alertId: historyData.alertId,
        webhookId: historyData.webhookId,
        webhookUrl: url,
        state: historyData.state,
        success: false,
        statusCode: null,
        errorMessage: error.message,
        timestamp: Math.floor(Date.now() / 1000)
      });
    }

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
      const isBreaching = checkAlertCondition(value, alert.condition, alert.threshold);
      const now = timestamp;

      // Update lastDataTimestamp for this alert (used for missing data detection)
      await Alert.update(
        { lastDataTimestamp: now },
        { where: { id: alert.id } }
      );

      if (isBreaching) {
        // Increment consecutive breaches
        const newBreachCount = alert.consecutiveBreaches + 1;

        const updates = {
          consecutiveBreaches: newBreachCount,
          consecutiveRecoveries: 0  // Only reset recoveries when breach threshold is met
        };

        // If already alerting and recovering, only reset recovery if we hit breach threshold
        // This prevents one bad value from immediately undoing recovery progress
        if (alert.isAlerting && alert.consecutiveRecoveries > 0) {
          if (newBreachCount < alert.enterThreshold) {
            // Still recovering, just had a setback - don't fully reset recovery
            console.log(`⚠️  Breach during recovery: ${metricName} ${alert.condition} ${alert.threshold} (value: ${value}, breach ${newBreachCount}/${alert.enterThreshold}, had ${alert.consecutiveRecoveries} recoveries - recovery paused)`);
            // Don't reset consecutiveRecoveries yet - let it compete with breaches
            delete updates.consecutiveRecoveries; // Keep the recovery counter
          } else {
            // Multiple consecutive breaches - recovery failed, back to full alert
            console.log(`🔴 Recovery failed: ${metricName} ${alert.condition} ${alert.threshold} (value: ${value}, ${newBreachCount} consecutive breaches)`);
            updates.consecutiveRecoveries = 0;
          }
        }
        // Already alerting but not recovering - just still breaching
        else if (alert.isAlerting) {
          console.log(`🔴 Still breaching: ${metricName} ${alert.condition} ${alert.threshold} (value: ${value}, alert active)`);
        }
        // Not yet alerting - count towards threshold
        else {
          console.log(`⚠️  Metric breaching: ${metricName} ${alert.condition} ${alert.threshold} (value: ${value}, breach count: ${newBreachCount}/${alert.enterThreshold})`);
        }

        // Check if we should enter alert state
        if (!alert.isAlerting && newBreachCount >= alert.enterThreshold) {
          console.log(`🚨 ENTERING ALERT STATE: ${metricName} (${newBreachCount} consecutive breaches reached threshold)`);
          updates.isAlerting = true;
          updates.lastTriggered = now;

          // Call webhooks immediately when entering alert state
          const payload = {
            appId,
            alert: {
              id: alert.id,
              metric: metricName,
              condition: alert.condition,
              threshold: alert.threshold,
              enterThreshold: alert.enterThreshold,
              exitThreshold: alert.exitThreshold
            },
            value,
            timestamp,
            state: 'entered',
            consecutiveBreaches: newBreachCount,
            triggeredAt: new Date(now).toISOString()
          };

          for (const webhook of webhooks) {
            console.log(`📞 Calling webhook [${webhook.format || 'generic'}]: ${webhook.name} → state: entered`);
            await callWebhook(webhook.url, payload, {
              appId,
              metric: metricName,
              alertId: alert.id,
              webhookId: webhook.id,
              state: 'entered'
            }, webhook.format || 'generic');
          }
        }
        // If already in alert state, check if we should call webhook again
        else if (alert.isAlerting) {
          const timeSinceLastTrigger = now - (alert.lastTriggered || 0);
          const webhookFrequencyMs = alert.webhookFrequencyMinutes * 60 * 1000;

          if (timeSinceLastTrigger >= webhookFrequencyMs) {
            console.log(`📢 Webhook repeat: ${metricName} (still in alert state)`);
            updates.lastTriggered = now;

            const payload = {
              appId,
              alert: {
                id: alert.id,
                metric: metricName,
                condition: alert.condition,
                threshold: alert.threshold,
                webhookFrequencyMinutes: alert.webhookFrequencyMinutes
              },
              value,
              timestamp,
              state: 'active',
              consecutiveBreaches: newBreachCount,
              triggeredAt: new Date(now).toISOString()
            };

            for (const webhook of webhooks) {
              console.log(`📞 Calling webhook [${webhook.format || 'generic'}]: ${webhook.name} → state: active (repeat notification)`);
              await callWebhook(webhook.url, payload, {
                appId,
                metric: metricName,
                alertId: alert.id,
                webhookId: webhook.id,
                state: 'active'
              }, webhook.format || 'generic');
            }
          }
        }

        await Alert.update(updates, { where: { id: alert.id } });

      } else {
        // Not breaching - increment consecutive recoveries, reset breaches
        const newRecoveryCount = alert.consecutiveRecoveries + 1;

        const updates = {
          consecutiveBreaches: 0,
          consecutiveRecoveries: newRecoveryCount
        };

        // Show different messages based on state
        if (alert.isAlerting) {
          console.log(`🔵 Metric recovering: ${metricName} ${alert.condition} ${alert.threshold} (value: ${value}, recovery count: ${newRecoveryCount}/${alert.exitThreshold})`);
        } else {
          console.log(`✅ Metric normal: ${metricName} ${alert.condition} ${alert.threshold} (value: ${value})`);
        }

        // Check if we should exit alert state
        if (alert.isAlerting && newRecoveryCount >= alert.exitThreshold) {
          console.log(`✅ EXITING ALERT STATE: ${metricName} (${newRecoveryCount} consecutive recoveries reached threshold)`);
          updates.isAlerting = false;

          // Optionally call webhook when exiting alert state
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
            state: 'recovered',
            consecutiveRecoveries: newRecoveryCount,
            triggeredAt: new Date(now).toISOString()
          };

          for (const webhook of webhooks) {
            console.log(`📞 Calling webhook [${webhook.format || 'generic'}]: ${webhook.name} → state: recovered`);
            await callWebhook(webhook.url, payload, {
              appId,
              metric: metricName,
              alertId: alert.id,
              webhookId: webhook.id,
              state: 'recovered'
            }, webhook.format || 'generic');
          }
        }

        await Alert.update(updates, { where: { id: alert.id } });
      }
    }
  } catch (error) {
    console.error('Error checking alerts:', error);
  }
}

// Background job to check for missing data on alerts configured to treat missing as breach
async function checkForMissingData() {
  try {
    // Find all enabled alerts with treatMissingAsBreach enabled
    const alerts = await Alert.findAll({
      where: {
        enabled: true,
        treatMissingAsBreach: true
      }
    });

    const now = Math.floor(Date.now() / 1000);

    for (const alert of alerts) {
      // Skip if no data has ever been received
      if (!alert.lastDataTimestamp) {
        continue;
      }

      // Calculate how long since last data
      const secondsSinceLastData = now - alert.lastDataTimestamp;
      const missedIntervals = Math.floor(secondsSinceLastData / alert.expectedIntervalSeconds);

      // If we've missed more than 2 intervals, treat as missing data (breach)
      if (missedIntervals >= 2) {
        console.log(`⚠️  Missing data detected: ${alert.metric} (last data: ${secondsSinceLastData}s ago, expected every ${alert.expectedIntervalSeconds}s)`);

        // Get webhooks for this app
        const webhooks = await WebhookConfig.findAll({
          where: {
            appId: alert.appId,
            enabled: true
          }
        });

        // Treat missing data as a breach
        const newBreachCount = alert.consecutiveBreaches + 1;
        const updates = {
          consecutiveBreaches: newBreachCount,
          consecutiveRecoveries: 0
        };

        // Check if we should enter alert state
        if (!alert.isAlerting && newBreachCount >= alert.enterThreshold) {
          console.log(`🔴 ENTERING ALERT STATE (Missing Data): ${alert.metric} (${newBreachCount} consecutive missing intervals)`);
          updates.isAlerting = true;
          updates.lastTriggered = now;

          // Call webhooks immediately when entering alert state
          const payload = {
            appId: alert.appId,
            alert: {
              id: alert.id,
              metric: alert.metric,
              condition: alert.condition,
              threshold: alert.threshold,
              enterThreshold: alert.enterThreshold,
              exitThreshold: alert.exitThreshold
            },
            value: 'NO DATA',
            timestamp: now,
            state: 'entered',
            consecutiveBreaches: newBreachCount,
            triggeredAt: new Date(now * 1000).toISOString(),
            reason: 'missing_data'
          };

          for (const webhook of webhooks) {
            console.log(`📞 Calling webhook [${webhook.format || 'generic'}]: ${webhook.name} → state: entered (missing data)`);
            await callWebhook(webhook.url, payload, {
              appId: alert.appId,
              metric: alert.metric,
              alertId: alert.id,
              webhookId: webhook.id,
              state: 'entered'
            }, webhook.format || 'generic');
          }
        }
        // If already in alert state, check if we should call webhook again
        else if (alert.isAlerting) {
          const timeSinceLastTrigger = now - (alert.lastTriggered || 0);
          const webhookFrequencyMs = alert.webhookFrequencyMinutes * 60;

          if (timeSinceLastTrigger >= webhookFrequencyMs) {
            console.log(`📢 Webhook repeat (missing data): ${alert.metric} (still no data)`);
            updates.lastTriggered = now;

            const payload = {
              appId: alert.appId,
              alert: {
                id: alert.id,
                metric: alert.metric,
                condition: alert.condition,
                threshold: alert.threshold,
                webhookFrequencyMinutes: alert.webhookFrequencyMinutes
              },
              value: 'NO DATA',
              timestamp: now,
              state: 'active',
              consecutiveBreaches: newBreachCount,
              triggeredAt: new Date(now * 1000).toISOString(),
              reason: 'missing_data'
            };

            for (const webhook of webhooks) {
              console.log(`📞 Calling webhook [${webhook.format || 'generic'}]: ${webhook.name} → state: active (repeat - missing data)`);
              await callWebhook(webhook.url, payload, {
                appId: alert.appId,
                metric: alert.metric,
                alertId: alert.id,
                webhookId: webhook.id,
                state: 'active'
              }, webhook.format || 'generic');
            }
          }
        }

        await Alert.update(updates, { where: { id: alert.id } });
      }
    }
  } catch (error) {
    console.error('Error checking for missing data:', error);
  }
}

// Run missing data check every 10 seconds
setInterval(checkForMissingData, 10000);
console.log('Missing data checker started (runs every 10 seconds)');

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

// Branding configuration endpoint (public)
app.get('/api/branding', (req, res) => {
  res.json(BRANDING);
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

    const { name, url, format } = req.body;

    if (!name || !url) {
      return res.status(400).json({ error: 'name and url are required' });
    }

    // Validate format if provided
    const webhookFormat = format || 'generic';
    if (!['generic', 'slack', 'discord'].includes(webhookFormat)) {
      return res.status(400).json({ error: 'format must be "generic", "slack", or "discord"' });
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
      format: webhookFormat,
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

    // Use 1-second granularity (convert milliseconds to seconds)
    const ts = timestamp ? Math.floor(timestamp / 1000) : Math.floor(Date.now() / 1000);

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
    const { limit = 100, range, interval } = req.query;

    if (!req.auth.appId) {
      return res.status(400).json({ error: 'X-App-Id header is required' });
    }

    const where = {
      appId: req.auth.appId,
      metric: name
    };

    // Handle time range (e.g., 24h, 7d, 30d)
    let bucketSize = 0; // in seconds
    if (range) {
      const now = Math.floor(Date.now() / 1000); // Convert to seconds to match our timestamp storage
      let seconds = 0;

      if (range.endsWith('h')) seconds = parseInt(range) * 60 * 60;
      else if (range.endsWith('d')) seconds = parseInt(range) * 24 * 60 * 60;
      else if (range.endsWith('m')) seconds = parseInt(range) * 60;

      if (seconds > 0) {
        where.timestamp = { [Op.gte]: now - seconds };
      }

      // Set bucket size based on time range for aggressive aggregation
      if (range === '1h') {
        bucketSize = 30; // 30-second buckets (~120 points)
      } else if (range === '24h') {
        bucketSize = 120; // 2-minute buckets (~720 points)
      } else if (range === '7d') {
        bucketSize = 600; // 10-minute buckets (~1,008 points)
      } else if (range === '30d') {
        bucketSize = 3600; // 1-hour buckets (~720 points)
      }
    }

    let data;
    let aggregationType = null;

    if (bucketSize > 0) {
      // Determine aggregation type based on metric name
      aggregationType = getAggregationType(name);

      // Build aggregation function based on type
      let aggFunction;
      if (aggregationType === 'sum') {
        aggFunction = 'SUM(CAST(value AS REAL))';
      } else if (aggregationType === 'max') {
        aggFunction = 'MAX(CAST(value AS REAL))';
      } else {
        aggFunction = 'AVG(CAST(value AS REAL))';
      }

      // Downsample to specified bucket size
      // Group by timestamp/bucketSize and aggregate based on metric type
      const rawData = await sequelize.query(
        `SELECT
          (timestamp / :bucketSize) * :bucketSize as timestamp,
          ${aggFunction} as value,
          MIN(CAST(value AS REAL)) as min_value,
          MAX(CAST(value AS REAL)) as max_value,
          COUNT(*) as sample_count
         FROM metrics
         WHERE appId = :appId AND metric = :metric AND timestamp >= :minTimestamp
         GROUP BY timestamp / :bucketSize
         ORDER BY timestamp ASC`,
        {
          replacements: {
            appId: req.auth.appId,
            metric: name,
            minTimestamp: where.timestamp ? where.timestamp[Op.gte] : 0,
            bucketSize: bucketSize
          },
          type: sequelize.QueryTypes.SELECT
        }
      );

      // Format to match original data structure
      data = rawData.map(row => ({
        timestamp: row.timestamp,
        value: row.value.toString(),
        min_value: row.min_value,
        max_value: row.max_value,
        sample_count: row.sample_count
      }));
    } else {
      // No downsampling - return raw data
      data = await Metric.findAll({
        where,
        order: [['timestamp', 'ASC']],
        limit: parseInt(limit),
        raw: true
      });
    }

    // Fill gaps if interval is specified
    if (interval && parseInt(interval) > 0 && data.length > 0) {
      const intervalSeconds = parseInt(interval);
      const filledData = [];

      // Get the time range
      const firstTimestamp = data[0].timestamp;
      const lastTimestamp = data[data.length - 1].timestamp;

      // Create a map of existing data points for quick lookup
      const dataMap = new Map();
      data.forEach(d => {
        dataMap.set(d.timestamp, d);
      });

      // Fill gaps from first to last timestamp at the specified interval
      for (let ts = firstTimestamp; ts <= lastTimestamp; ts += intervalSeconds) {
        if (dataMap.has(ts)) {
          filledData.push(dataMap.get(ts));
        } else {
          // Add a null data point for missing interval
          filledData.push({
            timestamp: ts,
            value: null,
            appId: req.auth.appId,
            metric: name
          });
        }
      }

      data = filledData;
    }

    res.json({
      metric: name,
      appId: req.auth.appId,
      count: data.length,
      downsampled: bucketSize > 0,
      aggregationType: aggregationType, // sum, max, or avg (only for downsampled data)
      intervalFilled: !!interval,
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
    const {
      metric,
      condition,
      threshold,
      enterThreshold = 3,
      exitThreshold = 3,
      webhookFrequencyMinutes = 5,
      treatMissingAsBreach = false,
      expectedIntervalSeconds = null
    } = req.body;

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

    // Validate thresholds
    if (enterThreshold < 1 || exitThreshold < 1) {
      return res.status(400).json({ error: 'enterThreshold and exitThreshold must be at least 1' });
    }

    if (webhookFrequencyMinutes < 1) {
      return res.status(400).json({ error: 'webhookFrequencyMinutes must be at least 1' });
    }

    // Validate treatMissingAsBreach configuration
    if (treatMissingAsBreach && !expectedIntervalSeconds) {
      return res.status(400).json({ error: 'expectedIntervalSeconds is required when treatMissingAsBreach is true' });
    }

    const alert = await Alert.create({
      appId: req.auth.appId,
      metric,
      condition,
      threshold: String(threshold),
      enterThreshold,
      exitThreshold,
      webhookFrequencyMinutes,
      treatMissingAsBreach,
      expectedIntervalSeconds
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

// GET /api/alert-states - Get which metrics are currently alerting
app.get('/api/alert-states', requireAuth, requirePermission('r'), async (req, res) => {
  try {
    if (!req.auth.appId) {
      return res.status(400).json({ error: 'X-App-Id header is required' });
    }

    const allAlerts = await Alert.findAll({
      where: {
        appId: req.auth.appId,
        enabled: true
      },
      attributes: ['metric', 'condition', 'threshold', 'consecutiveBreaches', 'consecutiveRecoveries', 'isAlerting', 'enterThreshold', 'exitThreshold', 'lastTriggered'],
      raw: true
    });

    // Return as a map of metric name to alert state
    const states = {};
    for (const alert of allAlerts) {
      // Determine the state based on breach/recovery counts
      let state = 'normal';

      if (alert.isAlerting) {
        // Alert is active
        if (alert.consecutiveRecoveries > 0 && alert.consecutiveRecoveries < alert.exitThreshold) {
          state = 'recovering'; // Blue - in recovery but still alerting
        } else {
          state = 'alerting'; // Red - fully alerting
        }
      } else {
        // Alert is not active
        if (alert.consecutiveBreaches > 0 && alert.consecutiveBreaches < alert.enterThreshold) {
          state = 'breaching'; // Yellow - breaching but not alerting yet
        }
      }

      states[alert.metric] = {
        state: state,
        isAlerting: alert.isAlerting,
        condition: alert.condition,
        threshold: alert.threshold,
        consecutiveBreaches: alert.consecutiveBreaches,
        consecutiveRecoveries: alert.consecutiveRecoveries,
        enterThreshold: alert.enterThreshold,
        exitThreshold: alert.exitThreshold,
        lastTriggered: alert.lastTriggered
      };
    }

    res.json(states);
  } catch (error) {
    console.error('Error fetching alert states:', error);
    res.status(500).json({ error: 'Failed to fetch alert states' });
  }
});

// GET /api/metrics/:name/details - Get detailed information about a specific metric
app.get('/api/metrics/:name/details', requireAuth, requirePermission('r'), async (req, res) => {
  try {
    if (!req.auth.appId) {
      return res.status(400).json({ error: 'X-App-Id header is required' });
    }

    const metricName = req.params.name;

    // Get alert configuration for this metric
    const alerts = await Alert.findAll({
      where: {
        appId: req.auth.appId,
        metric: metricName
      },
      raw: true
    });

    // Get webhook call history for this metric
    const webhookHistory = await WebhookCallHistory.findAll({
      where: {
        appId: req.auth.appId,
        metric: metricName
      },
      order: [['timestamp', 'DESC']],
      limit: 100, // Last 100 webhook calls
      raw: true
    });

    // Calculate webhook statistics
    const totalCalls = webhookHistory.length;
    const successfulCalls = webhookHistory.filter(h => h.success).length;
    const failedCalls = webhookHistory.filter(h => !h.success).length;
    const callsByState = {
      entered: webhookHistory.filter(h => h.state === 'entered').length,
      active: webhookHistory.filter(h => h.state === 'active').length,
      recovered: webhookHistory.filter(h => h.state === 'recovered').length
    };

    // Get latest metric data
    const latestMetrics = await Metric.findAll({
      where: {
        appId: req.auth.appId,
        metric: metricName
      },
      order: [['timestamp', 'DESC']],
      limit: 10,
      raw: true
    });

    // Determine aggregation type for this metric
    const aggregationType = getAggregationType(metricName);

    res.json({
      metric: metricName,
      aggregationType: aggregationType, // sum, max, or avg
      alerts: alerts,
      webhookStats: {
        totalCalls,
        successfulCalls,
        failedCalls,
        successRate: totalCalls > 0 ? ((successfulCalls / totalCalls) * 100).toFixed(1) : 0,
        callsByState
      },
      webhookHistory: webhookHistory,
      latestData: latestMetrics
    });
  } catch (error) {
    console.error('Error fetching metric details:', error);
    res.status(500).json({ error: 'Failed to fetch metric details' });
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
