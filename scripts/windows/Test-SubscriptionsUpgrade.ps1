param([string]$Baseline,[string]$Candidate)
$ErrorActionPreference = 'Stop'
$directory = Join-Path $env:RUNNER_TEMP 'ploom-migration'
foreach ($stage in @(@('0.1.3',$Baseline),@('0.2.0',$Candidate))) {
    $proc = Start-Process (Resolve-Path $stage[1]).Path -ArgumentList "/S /D=$directory" -Wait -PassThru
    if ($proc.ExitCode -ne 0) { throw "NSIS exit $($proc.ExitCode)" }
    node e2e/windows-update-pair.mjs "$directory/ploom.exe" $stage[0] '0.1.3'
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
