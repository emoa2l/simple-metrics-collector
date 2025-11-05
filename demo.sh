#!/bin/bash

# Metric Collector Alert System Demo
# This script demonstrates the smart alert threshold system
# Usage: ./demo.sh [webhook-url]

set -e

# Check if webhook URL was provided
WEBHOOK_URL="${1:-}"

# Function to wait for user input or timeout
wait_for_user() {
  local timeout=${1:-60}
  local message=${2:-"Press ENTER to continue or wait $timeout seconds..."}

  echo ""
  echo "$message"

  if read -t $timeout; then
    echo "✓ Continuing..."
  else
    echo "✓ Auto-continuing after timeout..."
  fi
  echo ""
}

PORT=${PORT:-3001}
BASE_URL="http://localhost:$PORT"

# Generate unique app ID for this demo run
TIMESTAMP=$(date +%s)
APP_ID="demo-app-${TIMESTAMP}"

# Read master key from .env file
if [ -f .env ]; then
  MASTER_KEY=$(grep "^MASTER_KEY=" .env | cut -d '=' -f2)
else
  MASTER_KEY="master-key-change-me"
fi

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  Metric Collector - Smart Alert Threshold System Demo         ║"
echo "║  Server: $BASE_URL                                    ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "📱 Demo App ID: $APP_ID"
echo "   (Unique for this demo run - isolated from previous demos)"
echo ""
if [ -n "$WEBHOOK_URL" ] && [ "$WEBHOOK_URL" != "https://webhook.site/unique-webhook-id" ]; then
  echo "🔔 Webhook URL: $WEBHOOK_URL"
  echo ""
fi

# Step 1: Create API keys using master key
echo "🔑 Creating API Keys..."
echo "────────────────────────────────────────────────────────────────"

# Create producer key (write-only)
PRODUCER_RESPONSE=$(curl -s -X POST $BASE_URL/api/keys \
  -H "X-API-Key: $MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"role": "w", "name": "Demo Producer Key"}')

PRODUCER_KEY=$(echo $PRODUCER_RESPONSE | grep -o '"key":"[^"]*"' | cut -d'"' -f4)

if [ -z "$PRODUCER_KEY" ]; then
  echo "❌ Failed to create producer key"
  echo "Response: $PRODUCER_RESPONSE"
  exit 1
fi

echo "✓ Producer key created (write-only - used by demo script)"

# Create reader key (read-only)
READER_RESPONSE=$(curl -s -X POST $BASE_URL/api/keys \
  -H "X-API-Key: $MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"role": "r", "name": "Demo Reader Key"}')

READER_KEY=$(echo $READER_RESPONSE | grep -o '"key":"[^"]*"' | cut -d'"' -f4)

if [ -z "$READER_KEY" ]; then
  echo "❌ Failed to create reader key"
  echo "Response: $READER_RESPONSE"
  exit 1
fi

echo "✓ Reader key created (read-only - for you to watch the dashboard)"
echo ""
sleep 1

# Show credentials IMMEDIATELY
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  🎯 OPEN THE DASHBOARD NOW!                                    ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "📊 Direct Dashboard Link (auto-login):"
echo "   http://localhost:$PORT?appId=$APP_ID&apiKey=$READER_KEY"
echo ""
echo "   Or manually enter credentials at: http://localhost:$PORT"
echo ""
echo "🔑 Credentials (if needed):"
echo ""
echo "   ┌─────────────────────────────────────────────────────────────┐"
echo "   │ API Key: $READER_KEY │"
echo "   │ App ID:  $APP_ID                                            │"
echo "   └─────────────────────────────────────────────────────────────┘"
echo ""
echo "   💡 This is a READ-ONLY key - you can watch but not modify"
echo "      The demo script uses a separate WRITE-ONLY key"
echo ""
echo "⏱️  You have 15 seconds to open the dashboard..."
echo "   Watch as metrics appear and alerts trigger in real-time!"
echo ""

for i in {15..1}; do
  echo -ne "   Starting in $i seconds...\r"
  sleep 1
done
echo ""
echo "🚀 Demo starting now!"
echo ""
sleep 1

# Use producer key for sending metrics
API_KEY="$PRODUCER_KEY"

# Step 1: Configure Webhook
echo "🔔 Step 1: Configuring Webhook"
echo "────────────────────────────────────────────────────────────────"

# Determine webhook format based on URL
WEBHOOK_FORMAT="generic"
if [ -n "$WEBHOOK_URL" ]; then
  if [[ "$WEBHOOK_URL" == *"hooks.slack.com"* ]]; then
    WEBHOOK_FORMAT="slack"
    echo "✓ Detected Slack webhook - will format messages for Slack"
  fi
  echo "Using webhook: $WEBHOOK_URL"
  echo "Format: $WEBHOOK_FORMAT"
else
  # Use default webhook.site URL if none provided
  WEBHOOK_URL="https://webhook.site/unique-webhook-id"
  echo "⚠️  No webhook URL provided - using placeholder"
  echo "To use your own webhook, run: ./demo.sh <webhook-url>"
  echo "For Slack webhooks, they'll be auto-detected and formatted!"
  echo ""
  echo "Using: $WEBHOOK_URL"
fi

curl -s -X POST $BASE_URL/api/webhooks \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: $APP_ID" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"Demo Webhook\", \"url\": \"$WEBHOOK_URL\", \"format\": \"$WEBHOOK_FORMAT\"}" > /dev/null

echo "✓ Webhook configured"
wait_for_user 60 "⏸️  Webhook configured. Press ENTER to create alerts or wait 60 seconds..."

# Step 2: Create Alerts
echo "⚠️  Step 2: Creating Alerts"
echo "────────────────────────────────────────────────────────────────"
echo "Creating alerts for cpu_usage, memory_usage, and error_rate..."
echo ""

# CPU Alert
echo "Alert 1: CPU Usage > 80%"
echo "  - Enter after 3 consecutive breaches"
echo "  - Exit after 3 consecutive recoveries"
echo "  - Webhook every 5 minutes while alerting"
curl -s -X POST $BASE_URL/api/alerts \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: $APP_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "metric": "cpu_usage",
    "condition": ">",
    "threshold": "80",
    "enterThreshold": 3,
    "exitThreshold": 3,
    "webhookFrequencyMinutes": 5
  }' > /dev/null
echo "  ✓ Created"
echo ""

# Memory Alert
echo "Alert 2: Memory Usage > 85%"
curl -s -X POST $BASE_URL/api/alerts \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: $APP_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "metric": "memory_usage",
    "condition": ">",
    "threshold": "85",
    "enterThreshold": 3,
    "exitThreshold": 3,
    "webhookFrequencyMinutes": 5
  }' > /dev/null
echo "  ✓ Created"
echo ""

# Error Rate Alert
echo "Alert 3: Error Rate > 5"
curl -s -X POST $BASE_URL/api/alerts \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: $APP_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "metric": "error_rate",
    "condition": ">",
    "threshold": "5",
    "enterThreshold": 3,
    "exitThreshold": 3,
    "webhookFrequencyMinutes": 5
  }' > /dev/null
echo "  ✓ Created"
echo ""
wait_for_user 60 "⏸️  All 3 alerts configured. Press ENTER to send baseline metrics or wait 60 seconds..."

# Step 3: Send normal metrics
echo "📊 Step 4: Sending Normal Metrics"
echo "────────────────────────────────────────────────────────────────"
echo "Sending baseline metrics (all within normal ranges)..."

curl -s -X POST $BASE_URL/api/metrics \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: $APP_ID" \
  -H "Content-Type: application/json" \
  -d '{"metric": "cpu_usage", "value": "45"}' > /dev/null
echo "  cpu_usage: 45% (normal)"

curl -s -X POST $BASE_URL/api/metrics \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: $APP_ID" \
  -H "Content-Type: application/json" \
  -d '{"metric": "memory_usage", "value": "60"}' > /dev/null
echo "  memory_usage: 60% (normal)"

curl -s -X POST $BASE_URL/api/metrics \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: $APP_ID" \
  -H "Content-Type: application/json" \
  -d '{"metric": "error_rate", "value": "1"}' > /dev/null
echo "  error_rate: 1 (normal)"

curl -s -X POST $BASE_URL/api/metrics \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: $APP_ID" \
  -H "Content-Type: application/json" \
  -d '{"metric": "response_time_ms", "value": "150"}' > /dev/null
echo "  response_time_ms: 150ms (normal)"

echo ""
echo "✓ All metrics normal - no alerts"
wait_for_user 60 "⏸️  Check dashboard - all metrics should be normal (white). Press ENTER to trigger CPU spike or wait 60 seconds..."

# Step 4: Trigger alert - breach 1
echo "🚨 Step 5: Simulating CPU Spike - Breach #1"
echo "────────────────────────────────────────────────────────────────"
curl -s -X POST $BASE_URL/api/metrics \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: $APP_ID" \
  -H "Content-Type: application/json" \
  -d '{"metric": "cpu_usage", "value": "92"}' > /dev/null
echo "  cpu_usage: 92% (breaching threshold of 80%)"
echo "  Status: Breach count 1/3 - NOT alerting yet"
wait_for_user 60 "⏸️  First breach detected. Press ENTER for 2nd breach or wait 60 seconds..."

# Step 5: Trigger alert - breach 2
echo "🚨 Step 6: CPU Still High - Breach #2"
echo "────────────────────────────────────────────────────────────────"
curl -s -X POST $BASE_URL/api/metrics \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: $APP_ID" \
  -H "Content-Type: application/json" \
  -d '{"metric": "cpu_usage", "value": "95"}' > /dev/null
echo "  cpu_usage: 95% (still breaching)"
echo "  Status: Breach count 2/3 - NOT alerting yet"
wait_for_user 60 "⏸️  Second consecutive breach. Press ENTER for 3rd breach (will trigger alert!) or wait 60 seconds..."

# Step 6: Trigger alert - breach 3 (ENTERS ALERT STATE)
echo "🔴 Step 7: CPU Critical - Breach #3 - ALERT TRIGGERED!"
echo "────────────────────────────────────────────────────────────────"
curl -s -X POST $BASE_URL/api/metrics \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: $APP_ID" \
  -H "Content-Type: application/json" \
  -d '{"metric": "cpu_usage", "value": "98"}' > /dev/null
echo "  cpu_usage: 98% (critical!)"
echo "  Status: Breach count 3/3 - ⚠️  ENTERING ALERT STATE"
echo "  Action: Webhook called with state='entered'"
echo ""
echo "  💡 Check the dashboard - cpu_usage should now have RED background!"
wait_for_user 60 "⏸️  ALERT ENTERED! Check dashboard - cpu_usage should be RED. Press ENTER to continue or wait 60 seconds..."

# Step 7: Continue sending high values
echo "🔴 Step 8: Alert Still Active"
echo "────────────────────────────────────────────────────────────────"
curl -s -X POST $BASE_URL/api/metrics \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: $APP_ID" \
  -H "Content-Type: application/json" \
  -d '{"metric": "cpu_usage", "value": "94"}' > /dev/null
echo "  cpu_usage: 94% (still high)"
echo "  Status: Alert ACTIVE - waiting for next webhook interval"
echo "  (Webhook will fire again in 5 minutes per configuration)"
wait_for_user 60 "⏸️  Alert still active. Press ENTER to start recovery or wait 60 seconds..."

# Step 8: Recovery starts - 1
echo "✅ Step 9: CPU Recovering - Recovery #1"
echo "────────────────────────────────────────────────────────────────"
curl -s -X POST $BASE_URL/api/metrics \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: $APP_ID" \
  -H "Content-Type: application/json" \
  -d '{"metric": "cpu_usage", "value": "75"}' > /dev/null
echo "  cpu_usage: 75% (back below threshold)"
echo "  Status: Recovery count 1/3 - Still alerting"
wait_for_user 60 "⏸️  First recovery. Alert still active. Press ENTER for 2nd recovery or wait 60 seconds..."

# Step 9: Recovery continues - 2
echo "✅ Step 10: CPU Stable - Recovery #2"
echo "────────────────────────────────────────────────────────────────"
curl -s -X POST $BASE_URL/api/metrics \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: $APP_ID" \
  -H "Content-Type: application/json" \
  -d '{"metric": "cpu_usage", "value": "70"}' > /dev/null
echo "  cpu_usage: 70%"
echo "  Status: Recovery count 2/3 - Still alerting"
wait_for_user 60 "⏸️  Second recovery. Press ENTER for 3rd recovery (will clear alert!) or wait 60 seconds..."

# Step 10: Recovery complete - 3 (EXITS ALERT STATE)
echo "🟢 Step 11: CPU Normal - Recovery #3 - ALERT CLEARED!"
echo "────────────────────────────────────────────────────────────────"
curl -s -X POST $BASE_URL/api/metrics \
  -H "X-API-Key: $API_KEY" \
  -H "X-App-Id: $APP_ID" \
  -H "Content-Type: application/json" \
  -d '{"metric": "cpu_usage", "value": "65"}' > /dev/null
echo "  cpu_usage: 65%"
echo "  Status: Recovery count 3/3 - ✅ EXITING ALERT STATE"
echo "  Action: Webhook called with state='recovered'"
echo ""
echo "  💡 Check the dashboard - cpu_usage should now be NORMAL (white)!"
wait_for_user 60 "⏸️  ALERT CLEARED! Check dashboard - cpu_usage should be white again. Press ENTER for more metrics or wait 60 seconds..."

# Step 11: Send more varied metrics for dashboard
echo "📊 Step 12: Sending More Metrics for Dashboard"
echo "────────────────────────────────────────────────────────────────"

for i in {1..5}; do
  curl -s -X POST $BASE_URL/api/metrics \
    -H "X-API-Key: $API_KEY" \
    -H "X-App-Id: $APP_ID" \
    -H "Content-Type: application/json" \
    -d "{\"metric\": \"memory_usage\", \"value\": \"$((60 + RANDOM % 15))\"}" > /dev/null
  sleep 2

  curl -s -X POST $BASE_URL/api/metrics \
    -H "X-API-Key: $API_KEY" \
    -H "X-App-Id: $APP_ID" \
    -H "Content-Type: application/json" \
    -d "{\"metric\": \"error_rate\", \"value\": \"$((1 + RANDOM % 3))\"}" > /dev/null
  sleep 2

  curl -s -X POST $BASE_URL/api/metrics \
    -H "X-API-Key: $API_KEY" \
    -H "X-App-Id: $APP_ID" \
    -H "Content-Type: application/json" \
    -d "{\"metric\": \"response_time_ms\", \"value\": \"$((100 + RANDOM % 100))\"}" > /dev/null
  sleep 2

  curl -s -X POST $BASE_URL/api/metrics \
    -H "X-API-Key: $API_KEY" \
    -H "X-App-Id: $APP_ID" \
    -H "Content-Type: application/json" \
    -d "{\"metric\": \"requests_per_sec\", \"value\": \"$((50 + RANDOM % 50))\"}" > /dev/null

  echo "  Batch $i/5 sent..."
  sleep 2
done

echo ""
echo "✓ Additional metrics sent for visualization"
echo ""
sleep 2

# Final summary
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  ✅ Demo Complete!                                             ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "📈 Metrics Created:"
echo "   • cpu_usage (triggered alert cycle - watch it go RED then WHITE!)"
echo "   • memory_usage"
echo "   • error_rate"
echo "   • response_time_ms"
echo "   • requests_per_sec"
echo ""
echo "⚠️  Alerts Configured:"
echo "   • cpu_usage > 80% (enter: 3 breaches, exit: 3 recoveries)"
echo "   • memory_usage > 85%"
echo "   • error_rate > 5"
echo ""
echo "📝 What Just Happened:"
echo "   1. ✓ Created producer (write) and reader (read) API keys"
echo "   2. ✓ Configured webhook for alert notifications"
echo "   3. ✓ Set up 3 alerts with smart thresholds"
echo "   4. ✓ Sent normal baseline metrics"
echo "   5. 🚨 CPU breached threshold 3 times → Alert ENTERED"
echo "   6. 🔴 Dashboard showed RED background"
echo "   7. ✅ CPU recovered 3 times → Alert CLEARED"
echo "   8. ⚪ Dashboard returned to normal"
echo ""
echo "🔄 Try Triggering Alerts Yourself:"
echo ""
echo "   # Trigger cpu_usage alert (send 3 times):"
echo "   for i in {1..3}; do"
echo "     curl -X POST http://localhost:$PORT/api/metrics \\"
echo "       -H \"X-API-Key: $PRODUCER_KEY\" \\"
echo "       -H \"X-App-Id: $APP_ID\" \\"
echo "       -H \"Content-Type: application/json\" \\"
echo "       -d '{\"metric\": \"cpu_usage\", \"value\": \"95\"}'"
echo "     sleep 2"
echo "   done"
echo ""
echo "   # Watch the dashboard - cpu_usage will turn RED!"
echo ""
echo "   # Then clear it (send 3 times):"
echo "   for i in {1..3}; do"
echo "     curl -X POST http://localhost:$PORT/api/metrics \\"
echo "       -H \"X-API-Key: $PRODUCER_KEY\" \\"
echo "       -H \"X-App-Id: $APP_ID\" \\"
echo "       -H \"Content-Type: application/json\" \\"
echo "       -d '{\"metric\": \"cpu_usage\", \"value\": \"50\"}'"
echo "     sleep 2"
echo "   done"
echo ""
echo "🔑 API Keys Created:"
echo "   Producer Key (write): $PRODUCER_KEY"
echo "   Reader Key (read):    $READER_KEY"
echo ""
echo "💡 Tip: Keep the dashboard open and run commands to see live updates!"
echo ""
