#requires -Version 5.1
[CmdletBinding()]
param([ValidateSet('Setup','Download')][string]$Mode='Setup')
$ErrorActionPreference='Stop'
if ($env:CI -or !$env:LOCALAPPDATA -or ![Environment]::UserInteractive) { throw 'Run on your own interactive Windows PC.' }
$env:GH_HOST='github.com'
$base=Join-Path $env:LOCALAPPDATA 'PloomRehearsal'
$keys=Join-Path $base 'keys'
function Run-Gh([string[]]$Arguments) {
    $result=& gh @Arguments
    if ($LASTEXITCODE) { throw "GitHub CLI failed: $($Arguments[0])" }
    $result
}
function Set-Secret([string]$Name,[string]$Value) {
    # Write exact UTF-8 bytes: a PowerShell 5 pipeline can replace non-ASCII passwords.
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName=(Get-Command gh.exe -CommandType Application).Source
    $info.Arguments="secret set $Name --repo $repo"
    $info.UseShellExecute=$false
    $info.RedirectStandardInput=$true
    $process=[Diagnostics.Process]::Start($info)
    $bytes=[Text.Encoding]::UTF8.GetBytes($Value)
    try {
        $pipe=$process.StandardInput.BaseStream
        $pipe.Write($bytes,0,$bytes.Length)
        $pipe.Close()
        $process.WaitForExit()
        if ($process.ExitCode) {throw "Could not set $Name"}
    } finally {[Array]::Clear($bytes,0,$bytes.Length); $process.Dispose()}
}
function Set-PrivateDirectory([string]$Path) {
    $dir=New-Item -ItemType Directory -Path $Path
    $acl=$dir.GetAccessControl()
    $acl.SetAccessRuleProtection($true,$false)
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
    $dir.SetAccessControl($acl)
}
function New-TestKeys {
    $pending=Join-Path $base ('pending-keys-'+[guid]::NewGuid())
    Set-PrivateDirectory $pending
    $tmp=Join-Path $pending ('tools-'+[guid]::NewGuid())
    $null=New-Item -ItemType Directory $tmp
    $cert=$null
    try {
        $zip=Join-Path $tmp 'signer.zip'
        $url='https://github.com/tauri-apps/tauri/releases/download/tauri-cli-v2.12.6/cargo-tauri-x86_64-pc-windows-msvc.zip'
        Invoke-WebRequest -UseBasicParsing $url -OutFile $zip
        if ((Get-FileHash $zip).Hash -ne '39636fa68bc00f13dd610fb57688f292e93742978cc35395f2f1be7c540b88a1') { throw 'Signer checksum mismatch' }
        Expand-Archive $zip $tmp
        $exe=(Get-ChildItem $tmp -Filter cargo-tauri.exe -Recurse).FullName
        Write-Host 'Create a non-empty Tauri password. Save it in your password manager.'
        & $exe signer generate -w (Join-Path $pending 'updater.key')
        if ($LASTEXITCODE) {throw 'Signer failed'}
        $password=Read-Host 'New Android PFX password (save in your password manager)' -AsSecureString
        if ($password.Length -lt 12) {throw 'Use at least 12 characters'}
        $cert=New-SelfSignedCertificate -Type Custom -Subject 'CN=Ploom Android Rehearsal' -FriendlyName 'ploom' -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -KeyUsage DigitalSignature -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(10)
        $null=Export-PfxCertificate -Cert $cert -FilePath (Join-Path $pending 'android.p12') -Password $password -ChainOption EndEntityCertOnly
        Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -DeleteKey
        $cert=$null
        Remove-Item -LiteralPath $tmp -Force -Recurse
        [IO.Directory]::Move($pending,$keys)
    } finally {
        try { if ($cert) { Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -DeleteKey } }
        finally { if (Test-Path $pending) {Remove-Item -LiteralPath $pending -Force -Recurse} }
    }
}
$owner=Run-Gh @('api','user','--jq','.login')
$repo="$owner/Ploom-rehearsal"
$info=(Run-Gh @('api',"repos/$repo")) | ConvertFrom-Json
if (!$info.private -or $info.owner.login -ne $owner -or $info.owner.type -ne 'User') { throw 'A dedicated personal private Ploom-rehearsal repository is required.' }
$ancestor=[IO.DirectoryInfo]::new($base)
while ($ancestor) {
    if ((Test-Path -LiteralPath (Join-Path $ancestor.FullName '.git')) -or ($ancestor.Exists -and ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint))) {throw 'Use private local storage outside Git and redirected directories.'}
    $ancestor=$ancestor.Parent
}
if (!(Test-Path $base)) { Set-PrivateDirectory $base }
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
if (!(Test-Path $keys)) {New-TestKeys}
if ((Get-Item $keys).Attributes -band [IO.FileAttributes]::ReparsePoint) {throw 'Refusing redirected key storage.'}
foreach ($file in 'android.p12','updater.key','updater.key.pub') {
    if (!(Test-Path -PathType Leaf (Join-Path $keys $file))) {throw "Incomplete key set. Restore a backup of $keys."}
    if ((Get-Item (Join-Path $keys $file)).Attributes -band [IO.FileAttributes]::ReparsePoint) {throw "Refusing linked key file"}
}
$trusted=@([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544')
foreach ($path in $keys,"$keys\updater.key","$keys\android.p12") {
    $acl=Get-Acl -LiteralPath $path
    foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $trusted) {
            throw "Restrict key folder permissions to your account before continuing: $path"
        }
    }
}
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
