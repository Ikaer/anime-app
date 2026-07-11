# Copies fresh AnimeTracker data from the Synology share to the local workspace,
# overwriting existing files. Invoked via `npm run data:copy` or the VSCode task.

$ErrorActionPreference = 'Stop'

$Source      = '\\Syno\root4\AppData\AnimeTracker\data'
$Destination = 'D:\Workspaces\local\AnimeTracker\data'

Write-Host "Copying data" -ForegroundColor Cyan
Write-Host "  from: $Source"
Write-Host "  to:   $Destination"

if (-not (Test-Path -LiteralPath $Source)) {
    Write-Host "ERROR: source path not reachable: $Source" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path -LiteralPath $Destination)) {
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
}

# /E   copy subdirectories including empty ones
# /IS  overwrite files even if identical (force fresh copy)
# /IT  overwrite tweaked files
# /R:2 retry twice, /W:2 wait 2s between retries
# /NFL /NDL /NP  quieter output (no per-file/dir lists, no progress %)
robocopy $Source $Destination /E /IS /IT /R:2 /W:2 /NFL /NDL /NP

# Robocopy exit codes 0-7 indicate success (8+ is a real failure).
$code = $LASTEXITCODE
if ($code -ge 8) {
    Write-Host "ERROR: robocopy failed with exit code $code" -ForegroundColor Red
    exit $code
}

Write-Host "Done (robocopy code $code)." -ForegroundColor Green
exit 0
