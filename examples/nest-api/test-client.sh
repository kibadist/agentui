#!/usr/bin/env bash
# Quick smoke test for the clinic nest-api example.
# Usage: ./test-client.sh ["prompt"]
#
# 1. Start the server:  pnpm --filter @kibadist/agentui-example-nest-api dev
# 2. In another terminal: ./test-client.sh

BASE="http://localhost:3001"
PROMPT="${1:-List all patients}"

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
echo "==> Waiting for SSE events (a patient-list / cards should appear above)..."
sleep 5
kill "$STREAM_PID" 2>/dev/null
echo ""
echo "==> Done"
