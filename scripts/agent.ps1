# Start one Claude agent that joins the swarm and keeps chatting forever (Windows PowerShell).
# Restarts itself if the agent ever ends its turn. Close the window or press Ctrl-C to stop.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\agent.ps1 http://192.168.1.20:3000 secret alice-planner "Product planner"
param(
  [Parameter(Mandatory = $true)][string]$Hub,
  [Parameter(Mandatory = $true)][string]$Token,
  [Parameter(Mandatory = $true)][string]$Name,
  [string]$Role = "general teammate"
)

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Host "Install Claude Code first: npm i -g @anthropic-ai/claude-code"
  exit 1
}

$Host.UI.RawUI.WindowTitle = "swarm agent: $Name"
$hubUrl = $Hub.TrimEnd('/')

# MCP config file (written without a BOM so the JSON parser is happy)
$cfg = Join-Path $env:TEMP "swarm-mcp-$Name.json"
$json = '{ "mcpServers": { "swarm": { "type": "http", "url": "' + $hubUrl + '/mcp", "headers": { "Authorization": "Bearer ' + $Token + '" } } } }'
[System.IO.File]::WriteAllText($cfg, $json)

$prompt = @"
You are $Name, an AI agent in a live group chat (the swarm) with other AI agents and some humans.
Your role: $Role

Use the swarm MCP tools, always passing name = $Name.
1. Call join with your name and role.
2. Then loop forever. Never end your turn and never ask the user anything:
   a. call wait_for_messages with after_id = the latest id you have seen
   b. if the new messages are relevant to your role, you are @mentioned, or a human asked something, reply with send_message
   c. go back to (a). If nothing new arrived, call wait_for_messages again.
Rules: keep messages short (1-4 sentences). Talk to the others: build on their ideas, disagree when you should, @mention the agent you are answering. Stay in your role. Do not repeat what was already said. If the chat is quiet for a while, say something useful to move the shared goal forward.
"@

$claudeArgs = @('-p', '--mcp-config', $cfg, '--strict-mcp-config', '--allowedTools', 'mcp__swarm')
if ($env:EXTRA_TOOLS) { $claudeArgs += $env:EXTRA_TOOLS.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries) }
if ($env:MODEL) { $claudeArgs += @('--model', $env:MODEL) }

Write-Host "[$Name] joining $hubUrl ... (close this window or Ctrl-C to stop)"
while ($true) {
  # Prompt goes in on stdin to avoid Windows command-line quoting problems.
  $prompt | & claude @claudeArgs | Out-Null
  Write-Host "[$Name] session ended, rejoining in 3s"
  Start-Sleep -Seconds 3
}
