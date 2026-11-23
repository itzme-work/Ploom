# CI smoke test uses public dummy payloads and a local stand-in for Tailscale.
$ErrorActionPreference='Stop'
foreach ($name in 'Rehearse','Serve') {
    $errors=$null
    $null=[Management.Automation.Language.Parser]::ParseFile("$PSScriptRoot\$name.ps1",[ref]$null,[ref]$errors)
    if ($errors.Count) {throw ($errors | Out-String)}
}
$tmp=Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid())
$null=New-Item -ItemType Directory $tmp
$job=$null
$oldPath=$env:Path
try {
    $env:Path="$tmp;$env:Path"
    Set-Content "$tmp\tailscale.cmd" '@echo {}' -Encoding Ascii
    $payload='itzme-work/Ploom/releases/download'
    foreach ($file in 'releases.json',"$payload/beta-feed/latest.json","$payload/v0.1.1-test/Ploom.exe","$payload/v0.1.1-test/Ploom-arm64.apk") {
        $path=Join-Path $tmp $file
        $null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path))
        [IO.File]::WriteAllText($path,'fixture')
    }
    $job=Start-Job -ScriptBlock {param($script,$dir,$path) $env:Path=$path; & $script -Directory $dir} -ArgumentList "$PSScriptRoot\Serve.ps1",$tmp,$env:Path
    for ($i=0;$i -lt 30;$i++) {
        try {$r=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8765/releases.json?page=1' -Headers @{Origin='http://tauri.localhost'};break}
        catch {if ($job.State -eq 'Failed') {Receive-Job $job};Start-Sleep -Seconds 1}
    }
    if ($r.StatusCode -ne 200 -or $r.Content -ne 'fixture' -or $r.Headers['Access-Control-Allow-Origin'] -ne 'http://tauri.localhost') {throw 'Feed/CORS smoke test failed'}
    try {Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8765/tailscale.cmd';throw 'Unexpected file exposed'} catch [Net.WebException] {if ($_.Exception.Response.StatusCode.value__ -ne 404) {throw}}
} finally {
    if ($job) {Stop-Job $job;Remove-Job $job}
    $env:Path=$oldPath
    Remove-Item -LiteralPath $tmp -Force -Recurse
}
