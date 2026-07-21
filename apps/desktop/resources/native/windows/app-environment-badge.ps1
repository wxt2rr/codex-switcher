param([Parameter(Mandatory=$true)][string]$RequestPath)
$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;

public static class CodexSwitcherTaskbar {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);

  [ComImport, Guid("EA1AFB91-9E28-4B86-90E9-9E9F2D9E9C31"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface ITaskbarList3 {
    void HrInit(); void AddTab(IntPtr hwnd); void DeleteTab(IntPtr hwnd); void ActivateTab(IntPtr hwnd); void SetActiveAlt(IntPtr hwnd);
    void MarkFullscreenWindow(IntPtr hwnd, bool fullscreen); void SetProgressValue(IntPtr hwnd, ulong completed, ulong total); void SetProgressState(IntPtr hwnd, int state);
    void RegisterTab(IntPtr hwnd, IntPtr owner); void UnregisterTab(IntPtr hwnd); void SetTabOrder(IntPtr hwnd, IntPtr insertBefore); void SetTabActive(IntPtr hwnd, IntPtr owner, uint reserved);
    void ThumbBarAddButtons(IntPtr hwnd, uint count, IntPtr buttons); void ThumbBarUpdateButtons(IntPtr hwnd, uint count, IntPtr buttons); void ThumbBarSetImageList(IntPtr hwnd, IntPtr imageList);
    void SetOverlayIcon(IntPtr hwnd, IntPtr icon, [MarshalAs(UnmanagedType.LPWStr)] string description);
  }
  [ComImport, Guid("56FDF344-FD6D-11D0-958A-006097C9A090")] public class CTaskbarList {}

  public static IntPtr Find(uint wanted) {
    IntPtr result = IntPtr.Zero;
    EnumWindows((h, p) => { uint pid; GetWindowThreadProcessId(h, out pid); if (pid == wanted && IsWindowVisible(h)) { result = h; return false; } return true; }, IntPtr.Zero);
    return result;
  }

  public static int Set(uint pid, string label, string color, bool clear) {
    var hwnd = Find(pid); if (hwnd == IntPtr.Zero) return 0;
    var taskbar = (ITaskbarList3)new CTaskbarList(); taskbar.HrInit();
    if (clear) { taskbar.SetOverlayIcon(hwnd, IntPtr.Zero, ""); return 1; }
    using (var bitmap = new Bitmap(32, 32))
    using (var graphics = Graphics.FromImage(bitmap))
    using (var brush = new SolidBrush(ColorTranslator.FromHtml(color)))
    using (var textBrush = new SolidBrush(Color.White))
    using (var font = new Font("Segoe UI", 18, FontStyle.Bold, GraphicsUnit.Pixel)) {
      graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
      graphics.FillEllipse(brush, 0, 0, 31, 31);
      var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
      graphics.DrawString(label, font, textBrush, new RectangleF(0, 0, 32, 30), format);
      var icon = bitmap.GetHicon();
      try { taskbar.SetOverlayIcon(hwnd, icon, label); } finally { DestroyIcon(icon); }
    }
    return 1;
  }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies System.Drawing
$request = Get-Content -Raw -LiteralPath $RequestPath | ConvertFrom-Json
$applied = 0
$unresolved = 0
foreach ($instance in @($request.instances)) {
  $clear = $request.action -eq 'clear'
  if ([CodexSwitcherTaskbar]::Set([uint32]$instance.pid, [string]$instance.label, [string]$instance.color, $clear) -eq 1) { $applied++ } else { $unresolved++ }
}
[pscustomobject]@{ applied=$applied; unresolved=$unresolved } | ConvertTo-Json -Compress
