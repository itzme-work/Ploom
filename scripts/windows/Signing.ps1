function Run-Gh([string[]]$Arguments) {
    $result=& gh @Arguments
    if ($LASTEXITCODE) { throw "GitHub CLI failed: $($Arguments[0])" }
    $result
}
function Set-Secret([string]$Name,[string]$Value,[switch]$Production) {
    # Write exact UTF-8 bytes: a PowerShell 5 pipeline can replace non-ASCII passwords.
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName=(Get-Command gh.exe -CommandType Application).Source
    $info.Arguments="secret set $Name --repo $repo"
    if ($Production) {$info.Arguments+=" --env ploom-release"}
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
function New-SigningKeys {
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
        $cert=New-SelfSignedCertificate -Type Custom -Subject "CN=$certName" -FriendlyName 'ploom' -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -KeyUsage DigitalSignature -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(10)
        $null=Export-PfxCertificate -Cert $cert -FilePath (Join-Path $pending 'android.p12') -Password $password -ChainOption EndEntityCertOnly
        $digest=[Security.Cryptography.SHA256]::Create().ComputeHash($cert.RawData)
        [IO.File]::WriteAllText((Join-Path $pending 'android-cert.sha256'),[BitConverter]::ToString($digest).Replace('-','').ToLowerInvariant())
        Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -DeleteKey
        $cert=$null
        Remove-Item -LiteralPath $tmp -Force -Recurse
        [IO.Directory]::Move($pending,$keys)
    } finally {
        try { if ($cert) { Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -DeleteKey } }
        finally { if (Test-Path $pending) {Remove-Item -LiteralPath $pending -Force -Recurse} }
    }
}
function Initialize-KeyDirectory {
$ancestor=[IO.DirectoryInfo]::new($base)
while ($ancestor) {
    if ((Test-Path -LiteralPath (Join-Path $ancestor.FullName '.git')) -or ($ancestor.Exists -and ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint))) {throw 'Use private local storage outside Git and redirected directories.'}
    $ancestor=$ancestor.Parent
}
if (!(Test-Path $base)) { Set-PrivateDirectory $base }
}
function Get-LocalKeySet {
if (!(Test-Path $keys)) {New-SigningKeys}
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
}
