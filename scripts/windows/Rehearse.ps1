#requires -Version 5.1
[CmdletBinding()]
param([ValidateSet('Setup','Download')][string]$Mode='Setup')
$ErrorActionPreference='Stop'
if ($env:CI -or !$env:LOCALAPPDATA -or ![Environment]::UserInteractive) { throw 'Run on your own interactive Windows PC.' }
$env:GH_HOST='github.com'
$base=Join-Path $env:LOCALAPPDATA 'PloomRehearsal'
$keys=Join-Path $base 'keys'
. "$PSScriptRoot\Signing.ps1"
$certName="Ploom Android Rehearsal"
$owner=Run-Gh @('api','user','--jq','.login')
$repo="$owner/Ploom-rehearsal"
$info=(Run-Gh @('api',"repos/$repo")) | ConvertFrom-Json
if (!$info.private -or $info.owner.login -ne $owner -or $info.owner.type -ne 'User') { throw 'A dedicated personal private Ploom-rehearsal repository is required.' }
Initialize-KeyDirectory
if ($Mode -eq 'Download') {
    $run=Read-Host 'Run ID (number at the end of the successful Signed test packages run URL)'
    if ($run -notmatch '^\d+$') {throw 'Invalid run ID'}
    $meta=(Run-Gh @('api',"repos/$repo/actions/runs/$run")) | ConvertFrom-Json
    if ($meta.path -ne '.github/workflows/rehearsal.yml' -or $meta.conclusion -ne 'success' -or $meta.head_branch -ne 'native-completion') {throw 'Expected a successful private signing run'}
    $output=Join-Path $base "run-$run"
    if (Test-Path $output) {throw "Already downloaded: $output"}
    $pending=Join-Path $base ('pending-run-'+[guid]::NewGuid())
    Set-PrivateDirectory $pending
    try {
      foreach ($name in 'private-rehearsal-site','rehearsal-0.1.0-Windows','rehearsal-0.1.0-Linux') {
        Run-Gh @('run','download',$run,'--repo',$repo,'--name',$name,'--dir',(Join-Path $pending $name))
      }
      [IO.Directory]::Move($pending,$output)
    } finally {if (Test-Path $pending) {Remove-Item -LiteralPath $pending -Force -Recurse}}
    & "$PSScriptRoot\Serve.ps1" -Directory (Join-Path $output 'private-rehearsal-site')
    return
}
$expected=Run-Gh @('api','repos/itzme-work/Ploom/commits/native-completion','--jq','.sha')
$actual=Run-Gh @('api',"repos/$repo/commits/native-completion",'--jq','.sha')
if ($actual -ne $expected) {throw 'Private copy differs from upstream. Import the reviewed native-completion branch before configuring secrets.'}
$ts=(& tailscale status --json | ConvertFrom-Json)
if ($LASTEXITCODE -or $ts.BackendState -ne 'Running') {throw 'Connect Tailscale first'}
$hostName=$ts.Self.DNSName.TrimEnd('.')
if ($hostName -notmatch '^[a-zA-Z0-9.-]+\.ts\.net$') {throw 'Enable MagicDNS for this PC'}
Write-Host "Trusted destination: $repo at $actual. Test HTTPS host: $hostName"
if ((Read-Host 'Confirm private repository by typing its full name') -cne $repo) {return}
Run-Gh @('repo','edit',$repo,'--default-branch','native-completion')
Get-LocalKeySet
Write-Host "Copy encrypted keys from $keys to encrypted removable storage. Keep both passwords separately."
if ((Read-Host 'Type BACKUP after verifying the backup') -cne 'BACKUP') {return}
Run-Gh @('variable','set','STAGING_HOST','--repo',$repo,'--body',$hostName)
Run-Gh @('variable','set','TEST_UPDATER_PUBLIC_KEY','--repo',$repo,'--body',([IO.File]::ReadAllText("$keys\updater.key.pub").Trim()))
Set-Secret TEST_TAURI_KEY ([IO.File]::ReadAllText("$keys\updater.key").Trim())
Set-Secret TEST_ANDROID_P12_BASE64 ([Convert]::ToBase64String([IO.File]::ReadAllBytes("$keys\android.p12")))
foreach ($name in 'TEST_ANDROID_PASSWORD','TEST_TAURI_PASSWORD') {
    Write-Host "Enter the existing password for $name in the hidden prompt."
    $secure=Read-Host $name -AsSecureString
    if (!$secure.Length) {throw 'Empty password'}
    $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {Set-Secret $name ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr))}
    finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $secure.Dispose()}
}
Run-Gh @('workflow','run','rehearsal.yml','--repo',$repo,'--ref','native-completion')
Write-Host "Follow https://github.com/$repo/actions/workflows/rehearsal.yml"
