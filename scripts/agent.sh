#!/usr/bin/env bash
# Start one AI agent that joins the swarm and keeps chatting forever.
# Restarts itself if the agent ever ends its turn.
#
#   ./scripts/agent.sh <hub-url> <token> <name> "<role>" [engine]
#   engine: claude (default) | codex (ChatGPT Plus/Pro) | gemini (Google account)
#
#   ./scripts/agent.sh http://192.168.1.20:3000 secret alice-planner "Product planner" codex
set -u
HUB="${1:?hub url, e.g. http://192.168.1.20:3000}"
TOKEN="${2:?token (same SWARM_TOKEN the host used)}"
NAME="${3:?agent name}"
ROLE="${4:-general teammate}"
ENGINE="${5:-${ENGINE:-claude}}"
MODEL="${MODEL:-}"
EXTRA_TOOLS="${EXTRA_TOOLS:-}" # claude only, e.g. "Read Grep Glob WebSearch"
URL="${HUB%/}/mcp"
export SWARM_TOKEN="$TOKEN"

need() { command -v "$1" >/dev/null || { echo "Install $1 first: $2"; exit 1; }; }
case "$ENGINE" in
  claude) need claude "npm i -g @anthropic-ai/claude-code" ;;
  codex)  need codex  "npm i -g @openai/codex   (then run: codex login)" ;;
  gemini) need gemini "npm i -g @google/gemini-cli   (then run: gemini, and sign in)" ;;
  *) echo "unknown engine '$ENGINE' (use claude, codex or gemini)"; exit 1 ;;
esac

WORK="$(mktemp -d -t swarm-agent.XXXXXX)"
trap 'rm -rf "$WORK"; exit' INT TERM EXIT
cat > "$WORK/claude-mcp.json" <<JSON
{ "mcpServers": { "swarm": { "type": "http", "url": "$URL", "headers": { "Authorization": "Bearer $TOKEN" } } } }
JSON
mkdir -p "$WORK/.gemini"
cat > "$WORK/.gemini/settings.json" <<JSON
{ "mcpServers": { "swarm": { "type": "http", "url": "$URL", "headers": { "Authorization": "Bearer $TOKEN" }, "timeout": 120000, "trust": true } } }
JSON

PROMPT="You are ${NAME}, an AI agent (running on ${ENGINE}) in a live group chat, the swarm, with other AI agents and some humans.
Your role: ${ROLE}

Use the swarm MCP tools, always passing name = ${NAME}.
1. Call join with your name and role.
2. Then loop forever. Never end your turn and never ask the user anything:
   a. call wait_for_messages with after_id = the latest id you have seen
   b. if the new messages are relevant to your role, you are @mentioned, or a human asked something, reply with send_message
   c. go back to (a). If nothing new arrived, call wait_for_messages again.
Rules: keep messages short (1-4 sentences). Talk to the others: build on their ideas, disagree when you should, @mention the agent you are answering. Stay in your role. Do not repeat what was already said. If the chat is quiet for a while, say something useful to move the shared goal forward."

run_once() {
  case "$ENGINE" in
    claude)
      printf '%s' "$PROMPT" | claude -p --mcp-config "$WORK/claude-mcp.json" --strict-mcp-config \
        --allowedTools mcp__swarm $EXTRA_TOOLS ${MODEL:+--model "$MODEL"} ;;
    codex)
      printf '%s' "$PROMPT" | codex exec --skip-git-repo-check --sandbox read-only -C "$WORK" \
        -c mcp_servers.swarm.url="$URL" \
        -c mcp_servers.swarm.bearer_token_env_var=SWARM_TOKEN \
        -c mcp_servers.swarm.tool_timeout_sec=120 \
        -c mcp_servers.swarm.default_tools_approval_mode=approve \
        ${MODEL:+-m "$MODEL"} - ;;
    gemini)
      (cd "$WORK" && printf '%s' "$PROMPT" | GEMINI_CLI_TRUST_WORKSPACE=true \
        gemini -p "Start now." --allowed-mcp-server-names swarm ${MODEL:+-m "$MODEL"}) ;;
  esac
}

echo "[$NAME/$ENGINE] joining $HUB ... (Ctrl-C to stop)"
while true; do
  run_once > "$WORK/last.log" 2>&1
  echo "[$NAME/$ENGINE] session ended, rejoining in 3s. Last output: $(tail -c 300 "$WORK/last.log" | tr '\n' ' ')"
  sleep 3
done
