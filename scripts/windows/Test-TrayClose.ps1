param([Parameter(Mandatory)][int]$ProcessId)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class TrayWindowTest {
    public delegate bool Visitor(IntPtr h, IntPtr data);
    [DllImport("user32")] public static extern bool EnumWindows(Visitor cb, IntPtr data);
    [DllImport("user32")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder text, int length);
    [DllImport("user32")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    public static IntPtr Find(uint pid) {
        IntPtr window = IntPtr.Zero;
        EnumWindows(delegate(IntPtr h, IntPtr data) {
            uint owner;
            GetWindowThreadProcessId(h, out owner);
            if (owner != pid || !IsWindowVisible(h)) return true;
            var title = new StringBuilder(128);
            GetWindowText(h, title, title.Capacity);
            if (title.ToString() != "Ploom") return true;
            window = h;
            return false;
        }, IntPtr.Zero);
        return window;
    }
}
'@
$window = [TrayWindowTest]::Find($ProcessId)
if ($window -eq [IntPtr]::Zero) { throw 'Visible Ploom window missing' }
if (![TrayWindowTest]::PostMessage($window, 0x10, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'WM_CLOSE failed' }
$deadline = [DateTime]::UtcNow.AddSeconds(10)
while ([TrayWindowTest]::IsWindowVisible($window) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
if (![TrayWindowTest]::IsWindow($window) -or [TrayWindowTest]::IsWindowVisible($window)) { throw 'Ploom window was not hidden in tray' }
