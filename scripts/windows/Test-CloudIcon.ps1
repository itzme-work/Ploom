param([Parameter(Mandatory=$true)][string[]]$Paths, [string]$Installed)
Add-Type -AssemblyName System.Drawing
foreach ($path in @($Paths) + @($Installed)) {
    if (!$path) { continue }
    $actual = [System.Drawing.Icon]::ExtractAssociatedIcon((Resolve-Path $path)).ToBitmap()
    try {
        # Check the purple tile and light cloud in the actual embedded icon.
        foreach ($sample in @(@(0.5, 0.12, 85, 70, 183), @(0.52, 0.51, 231, 224, 255))) {
            $pixel = $actual.GetPixel([int]($actual.Width*$sample[0]), [int]($actual.Height*$sample[1]))
            if ([Math]::Abs($pixel.R-$sample[2]) -gt 10 -or [Math]::Abs($pixel.G-$sample[3]) -gt 10 -or [Math]::Abs($pixel.B-$sample[4]) -gt 10) {
                throw "Unexpected cloud icon in $path"
            }
        }
    } finally { $actual.Dispose() }
}
