param([Parameter(Mandatory = $true)][string]$HandleList)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WindowLayerProbe {
  public delegate bool EnumProc(IntPtr handle, IntPtr parameter);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr handle);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr handle, int index);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string className, string windowName);
}
'@
$taskOrder = [Collections.Generic.List[long]]::new()
$taskCallback = [WindowLayerProbe+EnumProc] {
  param($taskHandle, $taskParameter)
  $taskOrder.Add($taskHandle.ToInt64())
  return $true
}
[void][WindowLayerProbe]::EnumWindows($taskCallback, [IntPtr]::Zero)
$taskStates = foreach ($taskValue in $HandleList.Split(',')) {
  $taskHandle = [IntPtr]::new([long]$taskValue)
  [ordered]@{
    handle = $taskHandle.ToInt64()
    topmost = (([WindowLayerProbe]::GetWindowLongPtr($taskHandle, -20).ToInt64() -band 8) -ne 0)
    visible = [WindowLayerProbe]::IsWindowVisible($taskHandle)
    minimized = [WindowLayerProbe]::IsIconic($taskHandle)
    zIndex = $taskOrder.IndexOf($taskHandle.ToInt64())
  }
}
$taskTaskbar = [WindowLayerProbe]::FindWindow('Shell_TrayWnd', $null)
[ordered]@{
  windows = @($taskStates)
  foreground = [WindowLayerProbe]::GetForegroundWindow().ToInt64()
  taskbarTopmost = (([WindowLayerProbe]::GetWindowLongPtr($taskTaskbar, -20).ToInt64() -band 8) -ne 0)
} | ConvertTo-Json -Depth 4 -Compress
