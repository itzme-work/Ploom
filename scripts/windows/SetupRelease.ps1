#requires -Version 5.1
$ErrorActionPreference='Stop'
if ($env:CI -or !$env:LOCALAPPDATA -or ![Environment]::UserInteractive) {throw 'Use a trusted local Windows PC.'}
$env:GH_HOST='github.com'
$repo='itzme-work/Ploom'
$base=Join-Path $env:LOCALAPPDATA 'PloomRelease'
$keys=Join-Path $base 'keys'
$certName='Ploom Android Release'
. "$PSScriptRoot\Signing.ps1"
if ((Run-Gh @('api','user','--jq','.login')) -ne 'itzme-work') {throw 'Sign in as the repository owner.'}
if ((Read-Host "Type $repo to configure permanent release signing") -cne $repo) {return}
$envs=Run-Gh @('api','--paginate',"repos/$repo/environments",'--jq','.environments[].name')
if ('ploom-release' -notin @($envs)) {
    $null=Run-Gh @('api','--method','PUT',"repos/$repo/environments/ploom-release")
}
$existing=@(Run-Gh @('secret','list','--repo',$repo,'--env','ploom-release','--json','name','--jq','.[].name'))
$bindings=@(Run-Gh @('variable','list','--repo',$repo,'--env','ploom-release','--json','name','--jq','.[].name'))
$names=@('RELEASE_ANDROID_PASSWORD','RELEASE_ANDROID_P12_BASE64','RELEASE_TAURI_PASSWORD','RELEASE_TAURI_KEY')
if (($existing | Where-Object {$_ -in $names}) -and ('UPDATER_PUBLIC_KEY' -notin $bindings -or 'ANDROID_CERT_SHA256' -notin $bindings)) {throw 'Unidentified existing credentials. Restore and inspect the original bindings before proceeding.'}
Initialize-KeyDirectory
if (($bindings.Count -or $existing.Count) -and !(Test-Path $keys)) {throw 'Restore the original release keys first.'}
Get-LocalKeySet
$public=@{
    UPDATER_PUBLIC_KEY=[IO.File]::ReadAllText("$keys\updater.key.pub").Trim()
    ANDROID_CERT_SHA256=[IO.File]::ReadAllText("$keys\android-cert.sha256").Trim()
}
foreach ($name in $public.Keys) {
    if ($name -in $bindings -and (Run-Gh @('variable','get',$name,'--repo',$repo,'--env','ploom-release')) -cne $public[$name]) {throw 'Public key mismatch. Existing configuration preserved.'}
}
Write-Host "Back up $keys to encrypted offline storage, and keep both passwords separately."
if ((Read-Host 'Type BACKUP after checking the copy') -cne 'BACKUP') {return}
foreach ($name in $public.Keys) {
    if ($name -notin $bindings) {Run-Gh @('variable','set',$name,'--repo',$repo,'--env','ploom-release','--body',$public[$name])}
}
foreach ($name in $names) {
    if ($name -in $existing) {continue}
    if ($name -eq 'RELEASE_TAURI_KEY') {Set-Secret $name ([IO.File]::ReadAllText("$keys\updater.key").Trim()) -Production}
    elseif ($name -eq 'RELEASE_ANDROID_P12_BASE64') {Set-Secret $name ([Convert]::ToBase64String([IO.File]::ReadAllBytes("$keys\android.p12"))) -Production}
    else {
        $pass=Read-Host "Existing password for $name" -AsSecureString
        if (!$pass.Length) {throw 'Empty password'}
        $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($pass)
        try {Set-Secret $name ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)) -Production}
        finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr);$pass.Dispose()}
    }
}
Write-Host 'Release signing configured. Use Actions > Publish Ploom when ready.'
