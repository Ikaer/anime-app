# One-time §3 data-file rename (see docs/CLEANUP.md).
#
# Renames the four mis-named JSON data files in place, in a coordinated cutover
# while the app is stopped. Old code reads the old names, new code reads the new
# names, so this MUST run against a given data dir exactly when that dir's app is
# down and about to be redeployed with the renamed-literals build.
#
#   Dry run (default):  pwsh scripts/rename-data-files.ps1 -Path '\\Syno\root4\AppData\AnimeTracker\data'
#   Apply:              add -Execute
#
# Idempotent: rows already renamed are skipped. Comparisons are CASE-SENSITIVE
# against the real directory listing, because animes_MAL.json -> animes_mal.json
# is a case-only rename and the Synology backend is case-sensitive even though
# the Windows SMB client is not.

param(
    [string]$Path = '\\Syno\root4\AppData\AnimeTracker\data',
    [switch]$Execute
)

$ErrorActionPreference = 'Stop'

$renames = @(
    @{ Old = 'sync_checkpoint.json';     New = 'mal_season_checkpoint.json' },
    @{ Old = 'recommendations_MAL.json'; New = 'recommendations.json' },
    @{ Old = 'animes_anilist_tags.json'; New = 'animes_anilist_meta.json' },
    @{ Old = 'animes_MAL.json';          New = 'animes_mal.json' },   # case-only
    @{ Old = 'animes_SIMKL.json';        New = 'animes_simkl.json' }  # case-only
)

if (-not (Test-Path -LiteralPath $Path)) {
    Write-Host "ERROR: path not reachable: $Path" -ForegroundColor Red
    exit 1
}

Write-Host "Renaming data files in: $Path" -ForegroundColor Cyan
if (-not $Execute) { Write-Host "(dry run - pass -Execute to apply)" -ForegroundColor Yellow }

# Real on-disk names, exact case (Get-ChildItem preserves the case-sensitive
# backend's names over SMB).
$names = @(Get-ChildItem -LiteralPath $Path -File | Select-Object -ExpandProperty Name)

foreach ($r in $renames) {
    $hasOld = $names -ccontains $r.Old
    $hasNew = $names -ccontains $r.New

    if ($hasNew -and -not $hasOld) {
        Write-Host "  SKIP    $($r.New)  (already renamed)" -ForegroundColor DarkGray
        continue
    }
    if (-not $hasOld) {
        Write-Host "  MISS    $($r.Old)  (source not found - nothing to do)" -ForegroundColor Yellow
        continue
    }
    if ($hasOld -and $hasNew) {
        Write-Host "  CONFLICT  both $($r.Old) and $($r.New) exist - skipping to avoid clobber" -ForegroundColor Red
        continue
    }

    Write-Host "  RENAME  $($r.Old) -> $($r.New)" -ForegroundColor Green
    if ($Execute) {
        $oldPath = Join-Path $Path $r.Old
        $newPath = Join-Path $Path $r.New
        if ($r.Old -ieq $r.New) {
            # Case-only: go through a temp name so the SMB client can't treat it
            # as a same-name no-op.
            $tmpPath = Join-Path $Path ($r.New + '.tmprename')
            Move-Item -LiteralPath $oldPath -Destination $tmpPath -Force
            Move-Item -LiteralPath $tmpPath -Destination $newPath -Force
        } else {
            Rename-Item -LiteralPath $oldPath -NewName $r.New
        }
    }
}

# Verification pass: confirm the end state (only meaningful after -Execute).
if ($Execute) {
    Write-Host "Verifying..." -ForegroundColor Cyan
    $after = @(Get-ChildItem -LiteralPath $Path -File | Select-Object -ExpandProperty Name)
    $ok = $true
    foreach ($r in $renames) {
        if ($after -ccontains $r.Old) { Write-Host "  FAIL  old name still present: $($r.Old)" -ForegroundColor Red; $ok = $false }
    }
    if ($ok) { Write-Host "OK - no old names remain." -ForegroundColor Green }
    else     { exit 1 }
}

Write-Host "Done." -ForegroundColor Cyan
exit 0
