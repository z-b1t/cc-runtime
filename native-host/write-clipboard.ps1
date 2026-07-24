param(
  [Parameter(Mandatory = $true)][string]$FormatName,
  [Parameter(Mandatory = $true)][string]$JsonPath
)

$ErrorActionPreference = "Stop"

if ($JsonPath -eq "-") {
  $json = [Console]::In.ReadToEnd()
} else {
  $json = Get-Content -LiteralPath $JsonPath -Raw -Encoding UTF8
}

if ([string]::IsNullOrWhiteSpace($json)) {
  throw "empty json"
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class CcRuntimeClipboard {
  const uint GMEM_MOVEABLE = 0x0002;
  const uint CF_UNICODETEXT = 13;

  [DllImport("user32.dll", SetLastError = true)]
  static extern bool OpenClipboard(IntPtr hWndNewOwner);

  [DllImport("user32.dll", SetLastError = true)]
  static extern bool EmptyClipboard();

  [DllImport("user32.dll", SetLastError = true)]
  static extern bool CloseClipboard();

  [DllImport("user32.dll", SetLastError = true)]
  static extern IntPtr SetClipboardData(uint uFormat, IntPtr hMem);

  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern uint RegisterClipboardFormat(string lpszFormat);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr GlobalLock(IntPtr hMem);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GlobalUnlock(IntPtr hMem);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr GlobalFree(IntPtr hMem);

  static IntPtr AllocUnicode(string text) {
    byte[] bytes = Encoding.Unicode.GetBytes(text + "\0");
    IntPtr h = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)bytes.Length);
    if (h == IntPtr.Zero) throw new Exception("GlobalAlloc failed");
    IntPtr p = GlobalLock(h);
    if (p == IntPtr.Zero) {
      GlobalFree(h);
      throw new Exception("GlobalLock failed");
    }
    try {
      Marshal.Copy(bytes, 0, p, bytes.Length);
    } finally {
      GlobalUnlock(h);
    }
    return h;
  }

  static IntPtr AllocUtf8(string text) {
    byte[] bytes = Encoding.UTF8.GetBytes(text);
    // Electron writeBuffer stores raw bytes (no forced NUL); include trailing NUL for C-string safety.
    IntPtr h = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)(bytes.Length + 1));
    if (h == IntPtr.Zero) throw new Exception("GlobalAlloc failed");
    IntPtr p = GlobalLock(h);
    if (p == IntPtr.Zero) {
      GlobalFree(h);
      throw new Exception("GlobalLock failed");
    }
    try {
      Marshal.Copy(bytes, 0, p, bytes.Length);
      Marshal.WriteByte(p, bytes.Length, 0);
    } finally {
      GlobalUnlock(h);
    }
    return h;
  }

  public static void Write(string formatName, string json) {
    uint fmt = RegisterClipboardFormat(formatName);
    if (fmt == 0) throw new Exception("RegisterClipboardFormat failed");

    IntPtr hCustom = AllocUtf8(json);
    IntPtr hText = AllocUnicode(json);

    if (!OpenClipboard(IntPtr.Zero)) {
      GlobalFree(hCustom);
      GlobalFree(hText);
      throw new Exception("OpenClipboard failed");
    }
    try {
      EmptyClipboard();
      if (SetClipboardData(fmt, hCustom) == IntPtr.Zero) {
        GlobalFree(hCustom);
        throw new Exception("SetClipboardData custom failed");
      }
      // Ownership transferred to system on success.
      hCustom = IntPtr.Zero;
      if (SetClipboardData(CF_UNICODETEXT, hText) == IntPtr.Zero) {
        GlobalFree(hText);
        throw new Exception("SetClipboardData text failed");
      }
      hText = IntPtr.Zero;
    } finally {
      CloseClipboard();
      if (hCustom != IntPtr.Zero) GlobalFree(hCustom);
      if (hText != IntPtr.Zero) GlobalFree(hText);
    }
  }
}
"@

[CcRuntimeClipboard]::Write($FormatName, $json)
Write-Output "ok"
