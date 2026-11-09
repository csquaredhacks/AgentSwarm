# Start one AI agent that joins the swarm and keeps chatting forever (Windows PowerShell).
# Restarts itself if the agent ever ends its turn. Close the window or press Ctrl-C to stop.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\agent.ps1 <hub-url> <token> <name> "<role>" [engine]
#   engine: claude (default) | codex (ChatGPT Plus/Pro) | gemini (Google account)
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\agent.ps1 http://192.168.1.20:3000 secret bob-builder "Engineer" codex
param(
  [Parameter(Mandatory = $true)][string]$Hub,
  [Parameter(Mandatory = $true)][string]$Token,
  [Parameter(Mandatory = $true)][string]$Name,
  [string]$Role = "general teammate",
  [string]$Engine = $(if ($env:ENGINE) { $env:ENGINE } else { "claude" })
)

$installHint = @{
  claude = "npm i -g @anthropic-ai/claude-code"
  codex  = "npm i -g @openai/codex    (then run: codex login)"
  gemini = "npm i -g @google/gemini-cli    (then run: gemini, and sign in)"
}
if (-not $installHint.ContainsKey($Engine)) { Write-Host "unknown engine '$Engine' (use claude, codex or gemini)"; exit 1 }
if (-not (Get-Command $Engine -ErrorAction SilentlyContinue)) { Write-Host "Install $Engine first: $($installHint[$Engine])"; exit 1 }

$Host.UI.RawUI.WindowTitle = "swarm agent: $Name ($Engine)"
$url = $Hub.TrimEnd('/') + '/mcp'
$env:SWARM_TOKEN = $Token

# Per-agent working folder with config files (written without a BOM so JSON parsers are happy)
$work = Join-Path $env:TEMP "swarm-agent-$Name"
New-Item -ItemType Directory -Force -Path (Join-Path $work '.gemini') | Out-Null
$claudeCfg = Join-Path $work 'claude-mcp.json'
[System.IO.File]::WriteAllText($claudeCfg, '{ "mcpServers": { "swarm": { "type": "http", "url": "' + $url + '", "headers": { "Authorization": "Bearer ' + $Token + '" } } } }')
[System.IO.File]::WriteAllText((Join-Path $work '.gemini\settings.json'), '{ "mcpServers": { "swarm": { "type": "http", "url": "' + $url + '", "headers": { "Authorization": "Bearer ' + $Token + '" }, "timeout": 120000, "trust": true } } }')

$prompt = @"
You are $Name, an AI agent (running on $Engine) in a live group chat, the swarm, with other AI agents and some humans.
Your role: $Role

Use the swarm MCP tools, always passing name = $Name.
1. Call join with your name and role.
2. Then loop forever. Never end your turn and never ask the user anything:
   a. call wait_for_messages with after_id = the latest id you have seen
   b. if the new messages are relevant to your role, you are @mentioned, or a human asked something, reply with send_message
   c. go back to (a). If nothing new arrived, call wait_for_messages again.
Rules: keep messages short (1-4 sentences). Talk to the others: build on their ideas, disagree when you should, @mention the agent you are answering. Stay in your role. Do not repeat what was already said. If the chat is quiet for a while, say something useful to move the shared goal forward.
"@

# The prompt goes in on stdin and config values avoid double quotes,
# so Windows PowerShell's argument quoting can't mangle anything.
switch ($Engine) {
  'claude' {
    $cmdArgs = @('-p', '--mcp-config', $claudeCfg, '--strict-mcp-config', '--allowedTools', 'mcp__swarm')
    if ($env:EXTRA_TOOLS) { $cmdArgs += $env:EXTRA_TOOLS.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries) }
  }
  'codex' {
    $cmdArgs = @('exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', $work,
      '-c', "mcp_servers.swarm.url=$url",
      '-c', 'mcp_servers.swarm.bearer_token_env_var=SWARM_TOKEN',
      '-c', 'mcp_servers.swarm.tool_timeout_sec=120',
      '-c', 'mcp_servers.swarm.default_tools_approval_mode=approve')
  }
  'gemini' {
    $env:GEMINI_CLI_TRUST_WORKSPACE = 'true'
    $cmdArgs = @('-p', 'Start now.', '--allowed-mcp-server-names', 'swarm')
  }
}
if ($env:MODEL) { $cmdArgs += @($(if ($Engine -eq 'claude') { '--model' } else { '-m' }), $env:MODEL) }
if ($Engine -eq 'codex') { $cmdArgs += '-' }

Write-Host "[$Name/$Engine] joining $Hub ... (close this window or Ctrl-C to stop)"
Set-Location $work
while ($true) {
  $out = $prompt | & $Engine @cmdArgs 2>&1 | Out-String
  $tail = if ($out.Length -gt 300) { $out.Substring($out.Length - 300) } else { $out }
  Write-Host "[$Name/$Engine] session ended, rejoining in 3s. Last output: $tail"
  Start-Sleep -Seconds 3
}
