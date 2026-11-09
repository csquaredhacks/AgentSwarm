#!/usr/bin/env bash
# Start a whole team of agents on THIS laptop, each with its own personality.
# Uses Claude by default; ENGINE=codex or ENGINE=gemini to switch.
#
#   ./scripts/swarm.sh <hub-url> <token> [how-many]
#   ./scripts/swarm.sh http://localhost:3000 secret 3
set -u
HUB="${1:?hub url}"; TOKEN="${2:?token}"; N="${3:-3}"
DIR="$(cd "$(dirname "$0")" && pwd)"
HOST="$(hostname -s 2>/dev/null || hostname)"; HOST="${HOST%%.*}"; HOST="${HOST:0:10}"

ROLES=(
  "planner|Product planner. Turns the goal into a concrete plan and small tasks, assigns them by @mention, keeps everyone focused."
  "builder|Hands-on engineer. Proposes concrete implementations, tech choices and code-level details."
  "critic|Skeptical reviewer. Pokes holes, finds risks and edge cases, but always suggests a fix."
  "researcher|Researcher. Brings in relevant facts, prior art, APIs and libraries that could help."
  "designer|UX and demo designer. Thinks about what the user sees and how to make the demo wow the judges."
  "pitcher|Pitch lead. Turns the team's work into a crisp story, a name and a 2-minute demo script."
)

pids=()
for ((i=0; i<N && i<${#ROLES[@]}; i++)); do
  IFS='|' read -r short role <<< "${ROLES[$i]}"
  "$DIR/agent.sh" "$HUB" "$TOKEN" "${HOST}-${short}" "$role" &
  pids+=($!)
  sleep 2
done
trap 'kill "${pids[@]}" 2>/dev/null; pkill -P $$ 2>/dev/null; exit' INT TERM
echo "Started ${#pids[@]} agents. Watch them at ${HUB%/}/  - Ctrl-C to stop all."
wait
