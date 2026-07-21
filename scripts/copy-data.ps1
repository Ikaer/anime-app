# Copies fresh AnimeTracker data from the Synology share to the local workspace,
# overwriting existing files. Invoked via `npm run data:copy` or the VSCode task.

$ErrorActionPreference = 'Stop'

$Source      = '\\Syno\root4\AppData\AnimeTracker\data'
$Destination = 'E:\Workspace\local\AnimeTracker\data'

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

# /E   copy subdirectories including empty ones (the store is foldered since
#      docs/DATA-LAYOUT.md: catalog/ personal/ user/ auth/ sync/ cache/ logs/)
# /PURGE  delete destination files the source no longer has. Load-bearing after
#      the layout migration: without it a pre-layout local pull keeps its flat
#      animes_*.json next to the new folders, and the app's layout guard then
#      refuses to start on a store that looks half-migrated. The destination is
#      a pull of production, so mirroring is the intended semantics.
# /IS  overwrite files even if identical (force fresh copy)
# /IT  overwrite tweaked files
# /R:2 retry twice, /W:2 wait 2s between retries
# /NFL /NDL /NP  quieter output (no per-file/dir lists, no progress %)
robocopy $Source $Destination /E /PURGE /IS /IT /R:2 /W:2 /NFL /NDL /NP

# Robocopy exit codes 0-7 indicate success (8+ is a real failure).
$code = $LASTEXITCODE
if ($code -ge 8) {
    Write-Host "ERROR: robocopy failed with exit code $code" -ForegroundColor Red
    exit $code
}

Write-Host "Done (robocopy code $code)." -ForegroundColor Green
exit 0
