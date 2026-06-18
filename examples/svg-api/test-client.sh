#!/usr/bin/env bash
# Quick smoke test for the agent-observability svg-api example.
# Usage: ./test-client.sh ["prompt"]
#
# 1. Start the server:  pnpm --filter @kibadist/agentui-example-svg-api dev
# 2. In another terminal: ./test-client.sh

BASE="http://localhost:3003"
PROMPT="${1:-Visualize the deploy investigation}"

echo "==> Creating session..."
SESSION=$(curl -s -X POST "$BASE/agent/session" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
echo "    sessionId: $SESSION"

echo ""
echo "==> Opening SSE stream (will print events for ~6s)..."
curl -s -N "$BASE/agent/$SESSION/stream" &
STREAM_PID=$!
sleep 1

echo ""
echo "==> Sending action: \"$PROMPT\""
curl -s -X POST "$BASE/agent/$SESSION/action" \
  -H "Content-Type: application/json" \
  -d "{
    \"v\": 1,
    \"id\": \"$(uuidgen || echo act-1)\",
    \"ts\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"sessionId\": \"$SESSION\",
    \"kind\": \"action\",
    \"type\": \"action.submit\",
    \"name\": \"chat.send\",
    \"payload\": { \"message\": \"$PROMPT\" }
  }"

echo ""
echo "==> Waiting for SSE events (workflow-canvas / tool-timeline / etc. should appear above)..."
sleep 5
kill "$STREAM_PID" 2>/dev/null
echo ""
echo "==> Done"
