# Start a whole team of agents on THIS Windows laptop, each in its own minimized window.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\swarm.ps1 http://localhost:3000 secret 3
#
# Stop them: close the "swarm agent" windows, or run
#   powershell -ExecutionPolicy Bypass -File .\scripts\swarm.ps1 -Stop
param(
  [string]$Hub,
  [string]$Token,
  [int]$Count = 3,
  [switch]$Stop
)

$pidFile = Join-Path $env:TEMP "swarm-agents.pids"

if ($Stop) {
  if (Test-Path $pidFile) {
    foreach ($id in Get-Content $pidFile) { taskkill /PID $id /T /F 2>$null | Out-Null }
    Remove-Item $pidFile
  }
  Write-Host "Stopped swarm agents."
  exit 0
}

if (-not $Hub -or -not $Token) {
  Write-Host "Usage: swarm.ps1 <hub-url> <token> [count]   or   swarm.ps1 -Stop"
  exit 1
}

$roles = @(
  @('planner',    'Product planner. Turns the goal into a concrete plan and small tasks, assigns them by @mention, keeps everyone focused.'),
  @('builder',    'Hands-on engineer. Proposes concrete implementations, tech choices and code-level details.'),
  @('critic',     'Skeptical reviewer. Pokes holes, finds risks and edge cases, but always suggests a fix.'),
  @('researcher', 'Researcher. Brings in relevant facts, prior art, APIs and libraries that could help.'),
  @('designer',   'UX and demo designer. Thinks about what the user sees and how to make the demo wow the judges.'),
  @('pitcher',    'Pitch lead. Turns the team work into a crisp story, a name and a 2-minute demo script.')
)

$machine = $env:COMPUTERNAME.ToLower()
if ($machine.Length -gt 10) { $machine = $machine.Substring(0, 10) }
$agentScript = Join-Path $PSScriptRoot 'agent.ps1'
$n = [Math]::Min($Count, $roles.Count)

for ($i = 0; $i -lt $n; $i++) {
  $name = "$machine-$($roles[$i][0])"
  $argLine = "-NoProfile -ExecutionPolicy Bypass -File `"$agentScript`" `"$Hub`" `"$Token`" `"$name`" `"$($roles[$i][1])`""
  $p = Start-Process powershell -ArgumentList $argLine -WindowStyle Minimized -PassThru
  Add-Content -Path $pidFile -Value $p.Id
  Write-Host "started $name"
  Start-Sleep -Seconds 2
}

Write-Host "Started $n agents. Watch them at $($Hub.TrimEnd('/'))/"
Write-Host "Stop them with: powershell -ExecutionPolicy Bypass -File .\scripts\swarm.ps1 -Stop"
