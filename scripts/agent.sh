#!/usr/bin/env bash
# Start one Claude agent that joins the swarm and keeps chatting forever.
# Restarts itself if the agent ever ends its turn.
#
#   ./scripts/agent.sh <hub-url> <token> <name> "<role/personality>"
#   ./scripts/agent.sh http://192.168.1.20:3000 secret alice-planner "Product planner. Breaks ideas into tasks."
set -u
HUB="${1:?hub url, e.g. http://192.168.1.20:3000}"
TOKEN="${2:?token (same SWARM_TOKEN the host used)}"
NAME="${3:?agent name}"
ROLE="${4:-general teammate}"
MODEL="${MODEL:-}"            # e.g. MODEL=sonnet to save usage
EXTRA_TOOLS="${EXTRA_TOOLS:-}" # e.g. EXTRA_TOOLS="Read Grep Glob WebSearch" to let it look things up

command -v claude >/dev/null || { echo "Install Claude Code first: npm i -g @anthropic-ai/claude-code"; exit 1; }

CFG="$(mktemp -t swarm-mcp.XXXXXX).json"
cat > "$CFG" <<JSON
{ "mcpServers": { "swarm": { "type": "http", "url": "${HUB%/}/mcp", "headers": { "Authorization": "Bearer ${TOKEN}" } } } }
JSON
trap 'rm -f "$CFG"; exit' INT TERM EXIT

PROMPT="You are ${NAME}, an AI agent in a live group chat (the 'swarm') with other AI agents and some humans.
Your role: ${ROLE}

Use the swarm MCP tools, always passing name=\"${NAME}\".
1. Call join with your name and role.
2. Then loop forever. Never end your turn and never ask the user anything:
   a. call wait_for_messages with after_id = the latest id you have seen
   b. if the new messages are relevant to your role, you're @mentioned, or a human asked something, reply with send_message
   c. go back to (a). If nothing new arrived, call wait_for_messages again.
Rules: keep messages short (1-4 sentences). Talk to the others: build on their ideas, disagree when you should, @mention the agent you are answering. Stay in your role. Do not repeat what was already said. If the chat is quiet for a while, say something useful to move the shared goal forward."

echo "[$NAME] joining $HUB ... (Ctrl-C to stop)"
while true; do
  claude -p "$PROMPT" \
    --mcp-config "$CFG" --strict-mcp-config \
    --allowedTools mcp__swarm $EXTRA_TOOLS \
    ${MODEL:+--model "$MODEL"} \
    > /dev/null 2>&1
  echo "[$NAME] session ended, rejoining in 3s"
  sleep 3
done
