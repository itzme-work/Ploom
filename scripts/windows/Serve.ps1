#requires -Version 5.1
param([Parameter(Mandatory)][string]$Directory)
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath $Directory).ProviderPath
$prefix='itzme-work/Ploom/releases/download'
$files=@{}
foreach ($name in 'releases.json',"$prefix/v0.1.1-test/latest.json","$prefix/v0.1.1-test/Ploom.exe","$prefix/v0.1.1-test/Ploom-arm64.apk") {
    $item=Get-Item -LiteralPath (Join-Path $root $name)
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {throw "Invalid file: $name"}
    $files["/$name"]=$item.FullName
}
$status=& tailscale serve status --json
if ($LASTEXITCODE) {throw 'Cannot inspect existing Tailscale services'}
if (($status -join '') -match '"(?:TCP|Web|Services|AllowFunnel)"\s*:\s*\{\s*"') {throw 'Use a dedicated test PC with no existing Serve or Funnel configuration.'}
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,8765)
$listener.Start()
$started=$false
try {
    & tailscale serve --bg http://127.0.0.1:8765
    if ($LASTEXITCODE) {throw 'Tailscale Serve setup failed'}
    $started=$true
    Write-Host 'Private update site running. Keep this window open. Press Ctrl+C to stop.'
    while ($true) {
        if (!$listener.Pending()) {Start-Sleep -Milliseconds 100; continue}
        $client=$listener.AcceptTcpClient()
        try {
            $client.ReceiveTimeout=5000
            $client.SendTimeout=30000
            $stream=$client.GetStream()
            $reader=[IO.StreamReader]::new($stream,[Text.Encoding]::ASCII)
            $request=$reader.ReadLine()
            if ($request -notmatch '^GET ([^? ]+)(?:\?[^ ]*)? HTTP/1\.[01]$') {continue}
            $path=$Matches[1]
            $origin=''
            for ($i=0;$i -lt 64;$i++) {
                $line=$reader.ReadLine()
                if (!$line) {break}
                if ($line -match '^Origin: (https?://tauri\.localhost|tauri://localhost)$') {$origin=$Matches[1]}
            }
            $header="HTTP/1.1 404 Not Found`r`nContent-Length: 0"
            if ($files.ContainsKey($path)) {
                $file=Get-Item -LiteralPath $files[$path]
                $mime=if ($path.EndsWith('.json')) {'application/json'} else {'application/octet-stream'}
                $header="HTTP/1.1 200 OK`r`nContent-Type: $mime`r`nContent-Length: $($file.Length)"
            }
            if ($origin) {$header+="`r`nAccess-Control-Allow-Origin: $origin`r`nVary: Origin"}
            $bytes=[Text.Encoding]::ASCII.GetBytes("$header`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n")
            $stream.Write($bytes,0,$bytes.Length)
            if ($files.ContainsKey($path)) {
                $body=[IO.File]::OpenRead($files[$path])
                try {$body.CopyTo($stream)} finally {$body.Dispose()}
            }
        } catch [IO.IOException] {Write-Verbose 'Client disconnected'} finally {$client.Dispose()}
    }
} finally {
    $listener.Stop()
    if ($started) {& tailscale serve --https=443 off}
}
