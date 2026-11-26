$ErrorActionPreference = 'Stop'
$env:CGO_ENABLED = '0'
$source = Join-Path $env:RUNNER_TEMP 'sing-box-source.tar.gz'
Invoke-WebRequest 'https://codeload.github.com/SagerNet/sing-box/tar.gz/c005f35300ce76427dc285481ec5695f5b179cd2' -OutFile $source
if ((Get-FileHash $source).Hash -ne '1c4d2b3bf261a8d98e1b026be0bbcddbcb3f53bbca77eb15e8f25f7d4e602e59') { throw 'Source digest mismatch' }
$engine = New-Item -Type Directory 'apps/client/src-tauri/engine'
$checkout = New-Item -Type Directory "$env:RUNNER_TEMP/sing-box"
tar xf $source -C $checkout.FullName --strip-components 1
Push-Location $checkout
go mod vendor
if ($LASTEXITCODE) { throw 'Could not prepare verified source tree' }
$module = Join-Path $checkout.FullName 'vendor/github.com/sagernet/sing-tun'
$wintun = Join-Path $env:RUNNER_TEMP 'wintun.zip'
Invoke-WebRequest 'https://www.wintun.net/builds/wintun-0.14.1.zip' -OutFile $wintun
$overlay = Join-Path $env:RUNNER_TEMP 'wintun-overlay'
python "$env:GITHUB_WORKSPACE/scripts/windows-core/prepare.py" $module $wintun $overlay $overlay
if ($LASTEXITCODE) { throw 'Wintun verification failed' }
go build -mod=vendor -overlay "$overlay/overlay.json" -trimpath -buildvcs=false -tags 'with_quic,with_wireguard,with_utls,with_gvisor,badlinkname,tfogo_checklinkname0' -ldflags '-checklinkname=0 -X github.com/sagernet/sing-box/constant.Version=1.14.4' -o "$engine/sing-box.exe" ./cmd/sing-box
if ($LASTEXITCODE) { throw 'Core build failed' }
python -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); sys.exit((p/'wintun.dll').exists() or (pathlib.Path(sys.argv[2])/'wintun.dll').read_bytes() in (p/'sing-box.exe').read_bytes())" $engine.FullName $overlay
if ($LASTEXITCODE) { throw 'Unexpected embedded Wintun binary' }
go mod verify
if ($LASTEXITCODE) { throw 'Go module verification failed' }
go version -m "$engine/sing-box.exe" > "$env:RUNNER_TEMP/windows-core-buildinfo.txt"
python "$env:GITHUB_WORKSPACE/scripts/windows-core/notices.py" "$checkout/vendor" "$env:RUNNER_TEMP/windows-core-buildinfo.txt" "$engine/third-party-notices.txt"
if ($LASTEXITCODE) { throw 'Windows linked-module licenses missing' }
Pop-Location
Copy-Item LICENSES/GPL-3.0.txt,LICENSES/sing-box-1.14.4.txt,LICENSES/Apache-2.0.txt,LICENSES/Wintun-0.14.1.txt,LICENSES/Wintun-Go-MIT.txt,NOTICE $engine
$env:PLOOM_CORE_SHA256 = (Get-FileHash "$engine/sing-box.exe").Hash.ToLowerInvariant()
