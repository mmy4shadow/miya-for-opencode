import { spawnSync } from 'node:child_process';
import type { ProbeCaptureMethod, ProbeCaptureResult } from './types';

interface PrintWindowRaw {
  ok?: boolean;
  imageBase64?: string;
  blackFrame?: boolean;
  limitations?: string[];
  error?: string;
}

function parseMethodList(): ProbeCaptureMethod[] {
  const raw = String(process.env.MIYA_CAPTURE_PROBE_METHODS ?? 'wgc_hwnd,print_window')
    .trim()
    .toLowerCase();
  const parsed = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item === 'wgc_hwnd' || item === 'print_window' ? item : null))
    .filter((item): item is ProbeCaptureMethod => Boolean(item));
  if (parsed.length === 0) return ['wgc_hwnd', 'print_window'];
  return [...new Set(parsed)];
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function runWgcHelper(timeoutMs: number): ProbeCaptureResult {
  const command = String(process.env.MIYA_WGC_CAPTURE_HELPER_CMD ?? '').trim();
  if (!command) {
    return {
      ok: false,
      method: 'wgc_hwnd',
      limitations: ['wgc_helper_missing'],
      error: 'wgc_helper_missing',
    };
  }
  const result = spawnSync(command, [], {
    timeout: Math.max(500, timeoutMs),
    encoding: 'utf-8',
    shell: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    return {
      ok: false,
      method: 'wgc_hwnd',
      limitations: ['wgc_helper_exec_failed'],
      error: result.error.message || 'wgc_helper_exec_failed',
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      method: 'wgc_hwnd',
      limitations: ['wgc_helper_nonzero_exit'],
      error: String(result.stderr || `exit_${result.status}`).trim(),
    };
  }
  const parsed = parseJson<PrintWindowRaw>(String(result.stdout ?? '').trim());
  if (!parsed) {
    return {
      ok: false,
      method: 'wgc_hwnd',
      limitations: ['wgc_helper_invalid_json'],
      error: 'wgc_helper_invalid_json',
    };
  }
  const limitations = Array.isArray(parsed.limitations)
    ? parsed.limitations.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
  return {
    ok: parsed.ok === true && typeof parsed.imageBase64 === 'string' && parsed.imageBase64.length > 0,
    method: 'wgc_hwnd',
    imageBase64: typeof parsed.imageBase64 === 'string' ? parsed.imageBase64 : undefined,
    blackFrame: parsed.blackFrame === true,
    limitations,
    error: typeof parsed.error === 'string' ? parsed.error : undefined,
  };
}

function runPrintWindowCapture(timeoutMs: number): ProbeCaptureResult {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      method: 'print_window',
      limitations: ['platform_not_windows'],
      error: 'platform_not_windows',
    };
  }
  const script = `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
public static class MiyaPrintWindowProbe {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, int nFlags);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  public static string CaptureForeground() {
    IntPtr hwnd = GetForegroundWindow();
    if (hwnd == IntPtr.Zero) return "{\\"ok\\":false,\\"error\\":\\"no_foreground_window\\",\\"limitations\\":[\\"capture_probe_error:no_foreground_window\\"]}";
    if (!IsWindowVisible(hwnd)) return "{\\"ok\\":false,\\"error\\":\\"window_not_visible\\",\\"limitations\\":[\\"capture_probe_occluded\\"]}";
    RECT rect;
    if (!GetWindowRect(hwnd, out rect)) return "{\\"ok\\":false,\\"error\\":\\"window_rect_failed\\",\\"limitations\\":[\\"capture_probe_error:window_rect\\"]}";
    int width = Math.Max(1, rect.Right - rect.Left);
    int height = Math.Max(1, rect.Bottom - rect.Top);
    using (var bmp = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
      using (var g = Graphics.FromImage(bmp)) {
        IntPtr hdc = g.GetHdc();
        bool ok = false;
        try {
          ok = PrintWindow(hwnd, hdc, 0);
        } finally {
          g.ReleaseHdc(hdc);
        }
        if (!ok) {
          return "{\\"ok\\":false,\\"error\\":\\"print_window_failed\\",\\"limitations\\":[\\"capture_probe_error:print_window\\"]}";
        }
      }
      using (var small = new Bitmap(224, 224, PixelFormat.Format24bppRgb))
      using (var gs = Graphics.FromImage(small))
      using (var ms = new MemoryStream()) {
        gs.InterpolationMode = InterpolationMode.HighQualityBicubic;
        gs.DrawImage(bmp, 0, 0, 224, 224);
        long total = 0;
        int step = 8;
        int count = 0;
        for (int y = 0; y < small.Height; y += step) {
          for (int x = 0; x < small.Width; x += step) {
            Color c = small.GetPixel(x, y);
            total += (c.R + c.G + c.B);
            count += 1;
          }
        }
        double avg = count > 0 ? (double)total / (count * 3.0) : 0;
        bool black = avg < 6.0;
        small.Save(ms, ImageFormat.Png);
        string payload = Convert.ToBase64String(ms.ToArray());
        string json = "{\\"ok\\":true,\\"blackFrame\\":" + (black ? "true" : "false") + ",\\"imageBase64\\":\\"" + payload + "\\",\\"limitations\\":[]}";
        return json;
      }
    }
  }
}
"@
[MiyaPrintWindowProbe]::CaptureForeground()
`.trim();
  const run = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      timeout: Math.max(500, timeoutMs),
      encoding: 'utf-8',
      windowsHide: true,
    },
  );
  if (run.error) {
    return {
      ok: false,
      method: 'print_window',
      limitations: ['capture_probe_error:spawn'],
      error: run.error.message || 'spawn_failed',
    };
  }
  if (run.signal) {
    return {
      ok: false,
      method: 'print_window',
      timedOut: true,
      limitations: ['capture_probe_timeout'],
      error: String(run.signal),
    };
  }
  const parsed = parseJson<PrintWindowRaw>(String(run.stdout ?? '').trim());
  if (!parsed) {
    return {
      ok: false,
      method: 'print_window',
      limitations: ['capture_probe_error:invalid_json'],
      error: String(run.stderr ?? 'invalid_json').trim(),
    };
  }
  const limitations = Array.isArray(parsed.limitations)
    ? parsed.limitations.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
  return {
    ok: parsed.ok === true && typeof parsed.imageBase64 === 'string' && parsed.imageBase64.length > 0,
    method: 'print_window',
    imageBase64: typeof parsed.imageBase64 === 'string' ? parsed.imageBase64 : undefined,
    blackFrame: parsed.blackFrame === true,
    limitations,
    error: typeof parsed.error === 'string' ? parsed.error : undefined,
  };
}

export function captureFrameForScreenProbe(timeoutMs = 2_000): ProbeCaptureResult {
  const methods = parseMethodList();
  const limitations: string[] = [];
  for (const method of methods) {
    const result = method === 'wgc_hwnd' ? runWgcHelper(timeoutMs) : runPrintWindowCapture(timeoutMs);
    limitations.push(...result.limitations);
    if (result.ok) {
      return {
        ...result,
        limitations: [...new Set([...limitations, ...result.limitations])],
      };
    }
  }
  return {
    ok: false,
    limitations: [...new Set(limitations)].slice(0, 24),
    error: 'capture_tree_exhausted',
  };
}
