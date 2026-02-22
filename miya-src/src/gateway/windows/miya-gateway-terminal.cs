using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal sealed class GatewayTerminalOptions
{
    public string Workspace = "";
    public string NodePath = "";
    public string CliPath = "";
    public bool UseTsx;
    public string Title = "miya-gateway";
}

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        GatewayTerminalOptions options;
        try
        {
            options = ParseArgs(args);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "Invalid startup arguments: " + ex.Message,
                "miya-gateway",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            return 2;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (var form = new GatewayTerminalForm(options))
        {
            Application.Run(form);
        }
        return 0;
    }

    private static GatewayTerminalOptions ParseArgs(string[] args)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < args.Length; i += 1)
        {
            var token = args[i] ?? "";
            if (!token.StartsWith("--", StringComparison.Ordinal))
            {
                continue;
            }

            var eq = token.IndexOf('=');
            if (eq >= 0)
            {
                var keyInline = token.Substring(2, eq - 2).Trim();
                var valInline = token.Substring(eq + 1);
                if (keyInline.Length > 0)
                {
                    map[keyInline] = valInline;
                }
                continue;
            }

            var key = token.Substring(2).Trim();
            if (key.Length == 0)
            {
                continue;
            }
            var value = (i + 1) < args.Length ? (args[i + 1] ?? "") : "";
            if (!value.StartsWith("--", StringComparison.Ordinal))
            {
                map[key] = value;
                i += 1;
                continue;
            }

            map[key] = "1";
        }

        var options = new GatewayTerminalOptions();
        if (map.ContainsKey("workspace"))
        {
            options.Workspace = map["workspace"] ?? "";
        }
        if (map.ContainsKey("node"))
        {
            options.NodePath = map["node"] ?? "";
        }
        if (map.ContainsKey("cli"))
        {
            options.CliPath = map["cli"] ?? "";
        }
        if (map.ContainsKey("tsx"))
        {
            var rawTsx = (map["tsx"] ?? "").Trim();
            options.UseTsx = rawTsx == "1" || rawTsx.Equals("true", StringComparison.OrdinalIgnoreCase);
        }
        if (string.IsNullOrWhiteSpace(options.Workspace))
        {
            throw new InvalidOperationException("--workspace is required");
        }
        if (string.IsNullOrWhiteSpace(options.NodePath))
        {
            throw new InvalidOperationException("--node is required");
        }
        if (string.IsNullOrWhiteSpace(options.CliPath))
        {
            throw new InvalidOperationException("--cli is required");
        }

        return options;
    }
}

internal sealed class GatewayTerminalForm : Form
{
    private readonly GatewayTerminalOptions _options;
    private readonly RichTextBox _logBox;
    private readonly TextBox _inputBox;
    private readonly NotifyIcon _tray;
    private readonly ContextMenuStrip _trayMenu;
    private readonly ToolStripMenuItem _topMostItem;
    private readonly object _streamLock = new object();
    private readonly StringBuilder _pending = new StringBuilder();
    private readonly System.Windows.Forms.Timer _restartTimer;

    private IntPtr _pty;
    private IntPtr _ptyInputWrite;
    private IntPtr _ptyOutputRead;
    private PROCESS_INFORMATION _childInfo;
    private Thread _readThread;
    private bool _allowClose;
    private bool _hotkeyRegistered;
    private bool _shutdownRequested;
    private bool _restartScheduled;
    private int _restartAttempts;
    private DateTime _restartWindowStartedAtUtc = DateTime.MinValue;
    private Color _currentColor = Color.Gainsboro;

    private const int HOTKEY_ID = 0x4D49;
    private const int WM_HOTKEY = 0x0312;
    private const uint MOD_ALT = 0x0001;
    private const uint MOD_CONTROL = 0x0002;
    private const int SW_HIDE = 0;
    private const int SW_SHOW = 5;
    private const int MAX_RESTART_ATTEMPTS = 4;
    private const int RESTART_WINDOW_MS = 30000;
    private const int TERMINAL_HOST_EXIT_GATEWAY_STOPPED = 51;
    private const uint STILL_ACTIVE = 0x00000103;
    private const uint WAIT_TIMEOUT = 0x00000102;

    public GatewayTerminalForm(GatewayTerminalOptions options)
    {
        _options = options;
        Text = options.Title;
        StartPosition = FormStartPosition.CenterScreen;
        var workingArea = Screen.PrimaryScreen != null
            ? Screen.PrimaryScreen.WorkingArea
            : new Rectangle(0, 0, 1280, 900);
        Width = Math.Min(1160, Math.Max(920, workingArea.Width - 60));
        Height = Math.Min(760, Math.Max(560, workingArea.Height - 80));
        MinimumSize = new Size(900, 560);
        BackColor = Color.Black;
        ForeColor = Color.Gainsboro;
        Font = new Font("Consolas", 10.0f, FontStyle.Regular, GraphicsUnit.Point);
        Icon = SystemIcons.Application;

        _logBox = new RichTextBox();
        _logBox.Dock = DockStyle.Fill;
        _logBox.ReadOnly = true;
        _logBox.Multiline = true;
        _logBox.BackColor = Color.Black;
        _logBox.ForeColor = Color.Gainsboro;
        _logBox.BorderStyle = BorderStyle.None;
        _logBox.HideSelection = false;
        _logBox.ShortcutsEnabled = true;
        _logBox.Font = new Font("Consolas", 10.0f, FontStyle.Regular, GraphicsUnit.Point);

        _inputBox = new TextBox();
        _inputBox.Dock = DockStyle.Bottom;
        _inputBox.Height = 30;
        _inputBox.BorderStyle = BorderStyle.FixedSingle;
        _inputBox.BackColor = Color.FromArgb(18, 18, 18);
        _inputBox.ForeColor = Color.Gainsboro;
        _inputBox.Font = new Font("Consolas", 10.0f, FontStyle.Regular, GraphicsUnit.Point);
        _inputBox.KeyDown += OnInputKeyDown;

        Controls.Add(_logBox);
        Controls.Add(_inputBox);

        _trayMenu = new ContextMenuStrip();
        _trayMenu.Items.Add("Show/Hide", null, delegate { ToggleWindowVisibility(); });
        _topMostItem = new ToolStripMenuItem("Always On Top", null, delegate
        {
            TopMost = !TopMost;
            _topMostItem.Checked = TopMost;
        });
        _topMostItem.Checked = false;
        _trayMenu.Items.Add(_topMostItem);
        _trayMenu.Items.Add("Exit Terminal", null, delegate
        {
            _allowClose = true;
            Close();
        });

        _tray = new NotifyIcon();
        _tray.Icon = SystemIcons.Application;
        _tray.Text = options.Title;
        _tray.Visible = true;
        _tray.ContextMenuStrip = _trayMenu;
        _tray.DoubleClick += delegate { ToggleWindowVisibility(); };

        _restartTimer = new System.Windows.Forms.Timer();
        _restartTimer.Interval = 1200;
        _restartTimer.Tick += OnRestartTimerTick;

        Resize += OnResizeHideToTray;
        FormClosing += OnFormClosing;
        Shown += delegate
        {
            try
            {
                StartConPtySession();
                AppendHostLine("terminal attached");
            }
            catch (Exception ex)
            {
                AppendHostLine("terminal startup failed: " + ex.Message, Color.IndianRed);
                ScheduleRestart("startup failed");
            }
            _inputBox.Focus();
        };
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        _hotkeyRegistered = RegisterHotKey(Handle, HOTKEY_ID, MOD_CONTROL | MOD_ALT, (uint)Keys.G);
    }

    protected override void OnHandleDestroyed(EventArgs e)
    {
        if (_hotkeyRegistered)
        {
            UnregisterHotKey(Handle, HOTKEY_ID);
            _hotkeyRegistered = false;
        }
        base.OnHandleDestroyed(e);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == HOTKEY_ID)
        {
            ToggleWindowVisibility();
            return;
        }
        base.WndProc(ref m);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            try
            {
                _restartTimer.Stop();
                _restartTimer.Dispose();
                _tray.Visible = false;
                _tray.Dispose();
                _trayMenu.Dispose();
            }
            catch
            {
            }
        }
        ShutdownConPty(true);
        base.Dispose(disposing);
    }

    private void OnResizeHideToTray(object sender, EventArgs e)
    {
        if (WindowState == FormWindowState.Minimized)
        {
            HideToTray();
        }
    }

    private void OnFormClosing(object sender, FormClosingEventArgs e)
    {
        if (!_allowClose)
        {
            e.Cancel = true;
            HideToTray();
            return;
        }
        ShutdownConPty(true);
    }

    private void OnInputKeyDown(object sender, KeyEventArgs e)
    {
        if (e.KeyCode != Keys.Enter)
        {
            return;
        }
        e.Handled = true;
        e.SuppressKeyPress = true;
        var text = _inputBox.Text ?? "";
        _inputBox.Clear();
        if (text.Trim().Length == 0)
        {
            return;
        }
        WriteToPty(text + "\r\n");
    }

    private void ToggleWindowVisibility()
    {
        if (Visible)
        {
            HideToTray();
            return;
        }
        ShowFromTray();
    }

    private void HideToTray()
    {
        if (IsDisposed) return;
        ShowInTaskbar = false;
        NativeShowWindow(Handle, SW_HIDE);
    }

    private void ShowFromTray()
    {
        if (IsDisposed) return;
        ShowInTaskbar = true;
        NativeShowWindow(Handle, SW_SHOW);
        WindowState = FormWindowState.Normal;
        Activate();
        BringToFront();
        _inputBox.Focus();
    }

    private void OnRestartTimerTick(object sender, EventArgs e)
    {
        _restartTimer.Stop();
        _restartScheduled = false;
        if (_shutdownRequested || IsDisposed) return;
        try
        {
            ShutdownConPty(false);
            StartConPtySession();
            AppendHostLine("terminal reattached", Color.LightGreen);
        }
        catch (Exception ex)
        {
            AppendHostLine("terminal reattach failed: " + ex.Message, Color.IndianRed);
            ScheduleRestart("reattach failed");
        }
    }

    private void ScheduleRestart(string reason)
    {
        if (_shutdownRequested || IsDisposed) return;
        if (InvokeRequired)
        {
            try
            {
                BeginInvoke((Action)(() => ScheduleRestart(reason)));
            }
            catch
            {
            }
            return;
        }
        if (_restartScheduled) return;

        var now = DateTime.UtcNow;
        if (
            _restartWindowStartedAtUtc == DateTime.MinValue ||
            (now - _restartWindowStartedAtUtc).TotalMilliseconds > RESTART_WINDOW_MS
        )
        {
            _restartWindowStartedAtUtc = now;
            _restartAttempts = 0;
        }
        _restartAttempts += 1;
        if (_restartAttempts > MAX_RESTART_ATTEMPTS)
        {
            AppendHostLine(
                "terminal host exited repeatedly; reconnect paused (" + reason + ")",
                Color.IndianRed
            );
            return;
        }

        _restartScheduled = true;
        _restartTimer.Interval = Math.Min(10000, 1200 + (_restartAttempts - 1) * 900);
        AppendHostLine(
            "terminal host disconnected; reconnecting (" + _restartAttempts + "/" + MAX_RESTART_ATTEMPTS + ")",
            Color.Khaki
        );
        _restartTimer.Start();
    }

    private void StartConPtySession()
    {
        _shutdownRequested = false;
        IntPtr ptyInputRead = IntPtr.Zero;
        IntPtr ptyInputWrite = IntPtr.Zero;
        IntPtr ptyOutputRead = IntPtr.Zero;
        IntPtr ptyOutputWrite = IntPtr.Zero;

        if (!CreatePipe(out ptyInputRead, out ptyInputWrite, IntPtr.Zero, 0))
        {
            throw new InvalidOperationException("CreatePipe(input) failed: " + Marshal.GetLastWin32Error());
        }
        if (!CreatePipe(out ptyOutputRead, out ptyOutputWrite, IntPtr.Zero, 0))
        {
            throw new InvalidOperationException("CreatePipe(output) failed: " + Marshal.GetLastWin32Error());
        }
        if (!SetHandleInformation(ptyInputWrite, HANDLE_FLAG_INHERIT, 0))
        {
            throw new InvalidOperationException("SetHandleInformation(inputWrite) failed");
        }
        if (!SetHandleInformation(ptyOutputRead, HANDLE_FLAG_INHERIT, 0))
        {
            throw new InvalidOperationException("SetHandleInformation(outputRead) failed");
        }

        var size = new COORD { X = 180, Y = 52 };
        var createPc = CreatePseudoConsole(size, ptyInputRead, ptyOutputWrite, 0, out _pty);
        if (createPc != 0)
        {
            throw new InvalidOperationException("CreatePseudoConsole failed: HRESULT=0x" + createPc.ToString("X8"));
        }

        CloseHandle(ptyInputRead);
        CloseHandle(ptyOutputWrite);
        ptyInputRead = IntPtr.Zero;
        ptyOutputWrite = IntPtr.Zero;

        IntPtr attrListSize = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attrListSize);
        IntPtr attrList = Marshal.AllocHGlobal(attrListSize);
        if (!InitializeProcThreadAttributeList(attrList, 1, 0, ref attrListSize))
        {
            throw new InvalidOperationException("InitializeProcThreadAttributeList failed");
        }

        try
        {
            IntPtr ptyValue = _pty;
            if (!UpdateProcThreadAttribute(
                    attrList,
                    0,
                    (IntPtr)PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
                    ptyValue,
                    (IntPtr)IntPtr.Size,
                    IntPtr.Zero,
                    IntPtr.Zero
                ))
            {
                throw new InvalidOperationException("UpdateProcThreadAttribute failed: " + Marshal.GetLastWin32Error());
            }

            var siex = new STARTUPINFOEX();
            siex.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
            siex.lpAttributeList = attrList;

            var args = BuildChildArguments();
            var cmdLine = new StringBuilder(args);
            if (!CreateProcessW(
                    _options.NodePath,
                    cmdLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    false,
                    EXTENDED_STARTUPINFO_PRESENT,
                    IntPtr.Zero,
                    _options.Workspace,
                    ref siex,
                    out _childInfo
                ))
            {
                throw new InvalidOperationException("CreateProcessW failed: " + Marshal.GetLastWin32Error());
            }
        }
        finally
        {
            DeleteProcThreadAttributeList(attrList);
            Marshal.FreeHGlobal(attrList);
        }

        if (_childInfo.hThread != IntPtr.Zero)
        {
            CloseHandle(_childInfo.hThread);
            _childInfo.hThread = IntPtr.Zero;
        }

        _ptyInputWrite = ptyInputWrite;
        _ptyOutputRead = ptyOutputRead;

        _readThread = new Thread(ReadLoop);
        _readThread.IsBackground = true;
        _readThread.Start();
        _restartAttempts = 0;
        _restartWindowStartedAtUtc = DateTime.MinValue;
    }

    private string BuildChildArguments()
    {
        var tokens = new List<string>();
        if (_options.UseTsx)
        {
            tokens.Add("--import");
            tokens.Add("tsx");
        }
        tokens.Add(_options.CliPath);
        tokens.Add("gateway");
        tokens.Add("terminal-host");
        tokens.Add("--workspace");
        tokens.Add(_options.Workspace);
        var args = new List<string>();
        foreach (var token in tokens)
        {
            args.Add(QuoteArg(token));
        }
        return string.Join(" ", args.ToArray());
    }

    private static string QuoteArg(string value)
    {
        if (value == null)
        {
            return "\"\"";
        }
        if (value.IndexOfAny(new[] { ' ', '\t', '"' }) < 0)
        {
            return value;
        }
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    private void ReadLoop()
    {
        var buffer = new byte[8192];
        bool unexpectedClosed = false;
        string readError = "";
        try
        {
            while (true)
            {
                if (_ptyOutputRead == IntPtr.Zero)
                {
                    break;
                }
                int bytesRead;
                var ok = ReadFile(_ptyOutputRead, buffer, buffer.Length, out bytesRead, IntPtr.Zero);
                if (!ok || bytesRead <= 0)
                {
                    unexpectedClosed = !_shutdownRequested;
                    break;
                }
                var text = Encoding.UTF8.GetString(buffer, 0, bytesRead);
                AppendAnsiText(text);
            }
        }
        catch (Exception ex)
        {
            unexpectedClosed = !_shutdownRequested;
            readError = ex.Message;
        }

        if (unexpectedClosed && !_allowClose)
        {
            int childExitCode;
            if (TryGetChildExitCode(out childExitCode))
            {
                if (childExitCode == TERMINAL_HOST_EXIT_GATEWAY_STOPPED)
                {
                    AppendHostLine("gateway stopped; closing terminal window.", Color.Gray);
                    Action closeAction = delegate
                    {
                        _allowClose = true;
                        Close();
                    };
                    if (InvokeRequired)
                    {
                        try
                        {
                            BeginInvoke(closeAction);
                        }
                        catch
                        {
                        }
                    }
                    else
                    {
                        closeAction();
                    }
                    return;
                }
            }
            if (readError.Length > 0)
            {
                AppendHostLine("terminal stream error: " + readError, Color.IndianRed);
            }
            ScheduleRestart("stream closed");
            return;
        }
        AppendHostLine("terminal stream closed", Color.Gray);
    }

    private bool TryGetChildExitCode(out int exitCode)
    {
        exitCode = 0;
        try
        {
            if (_childInfo.hProcess == IntPtr.Zero)
            {
                return false;
            }
            uint rawCode;
            if (!GetExitCodeProcess(_childInfo.hProcess, out rawCode))
            {
                return false;
            }
            if (rawCode == STILL_ACTIVE)
            {
                return false;
            }
            exitCode = unchecked((int)rawCode);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private void WriteToPty(string text)
    {
        if (_ptyInputWrite == IntPtr.Zero)
        {
            return;
        }
        try
        {
            var bytes = Encoding.UTF8.GetBytes(text);
            int written;
            WriteFile(_ptyInputWrite, bytes, bytes.Length, out written, IntPtr.Zero);
        }
        catch
        {
        }
    }

    private void AppendAnsiText(string text)
    {
        if (IsDisposed)
        {
            return;
        }

        lock (_streamLock)
        {
            _pending.Append(text);
            var data = _pending.ToString();
            _pending.Clear();

            int i = 0;
            int plainStart = 0;
            while (i < data.Length)
            {
                if (data[i] == '\x1b' && i + 1 < data.Length && data[i + 1] == '[')
                {
                    int m = data.IndexOf('m', i + 2);
                    if (m < 0)
                    {
                        _pending.Append(data.Substring(i));
                        break;
                    }
                    if (i > plainStart)
                    {
                        var plain = data.Substring(plainStart, i - plainStart);
                        AppendColored(plain, _currentColor);
                    }
                    var code = data.Substring(i + 2, m - (i + 2));
                    ApplyAnsiCode(code);
                    i = m + 1;
                    plainStart = i;
                    continue;
                }
                i += 1;
            }

            if (plainStart < data.Length && _pending.Length == 0)
            {
                var plainTail = data.Substring(plainStart);
                AppendColored(plainTail, _currentColor);
            }
        }
    }

    private void ApplyAnsiCode(string code)
    {
        var segments = code.Split(';');
        foreach (var segment in segments)
        {
            int value;
            if (!int.TryParse(segment, out value))
            {
                continue;
            }
            if (value == 0 || value == 39)
            {
                _currentColor = Color.Gainsboro;
            }
            else if (value == 30) _currentColor = Color.Black;
            else if (value == 31) _currentColor = Color.IndianRed;
            else if (value == 32) _currentColor = Color.LightGreen;
            else if (value == 33) _currentColor = Color.Gold;
            else if (value == 34) _currentColor = Color.DeepSkyBlue;
            else if (value == 35) _currentColor = Color.MediumOrchid;
            else if (value == 36) _currentColor = Color.Cyan;
            else if (value == 37) _currentColor = Color.Gainsboro;
            else if (value == 90) _currentColor = Color.Gray;
            else if (value == 91) _currentColor = Color.LightCoral;
            else if (value == 92) _currentColor = Color.PaleGreen;
            else if (value == 93) _currentColor = Color.Khaki;
            else if (value == 94) _currentColor = Color.SkyBlue;
            else if (value == 95) _currentColor = Color.Orchid;
            else if (value == 96) _currentColor = Color.Aquamarine;
            else if (value == 97) _currentColor = Color.White;
        }
    }

    private void AppendColored(string text, Color color)
    {
        if (string.IsNullOrEmpty(text))
        {
            return;
        }
        var normalized = text.Replace("\r", "");
        if (normalized.Length == 0)
        {
            return;
        }
        if (InvokeRequired)
        {
            try
            {
                BeginInvoke((Action)(() => AppendColored(normalized, color)));
            }
            catch
            {
            }
            return;
        }

        var followTail = IsTailVisible();
        _logBox.SelectionStart = _logBox.TextLength;
        _logBox.SelectionLength = 0;
        _logBox.SelectionColor = color;
        _logBox.AppendText(normalized);
        _logBox.SelectionColor = _logBox.ForeColor;
        if (followTail)
        {
            _logBox.SelectionStart = _logBox.TextLength;
            _logBox.ScrollToCaret();
        }
    }

    private bool IsTailVisible()
    {
        if (_logBox.TextLength <= 0) return true;
        var probePoint = new Point(
            Math.Max(0, _logBox.ClientSize.Width - 4),
            Math.Max(0, _logBox.ClientSize.Height - 4)
        );
        var index = _logBox.GetCharIndexFromPosition(probePoint);
        return index >= _logBox.TextLength - 2;
    }

    private void AppendHostLine(string message)
    {
        AppendHostLine(message, Color.Gray);
    }

    private void AppendHostLine(string message, Color color)
    {
        var line = DateTime.Now.ToString("HH:mm:ss") + " [gateway] " + message + Environment.NewLine;
        AppendColored(line, color);
    }

    private void ShutdownConPty(bool gracefulExit)
    {
        _shutdownRequested = true;
        _restartTimer.Stop();

        try
        {
            if (gracefulExit && _ptyInputWrite != IntPtr.Zero)
            {
                try
                {
                    WriteToPty("exit\r\n");
                }
                catch
                {
                }
            }
        }
        catch
        {
        }

        try
        {
            if (_ptyInputWrite != IntPtr.Zero)
            {
                CloseHandle(_ptyInputWrite);
                _ptyInputWrite = IntPtr.Zero;
            }
        }
        catch
        {
        }

        try
        {
            if (_childInfo.hProcess != IntPtr.Zero)
            {
                var wait = WaitForSingleObject(_childInfo.hProcess, gracefulExit ? 1200u : 300u);
                if (wait == WAIT_TIMEOUT)
                {
                    try
                    {
                        TerminateProcess(_childInfo.hProcess, 0);
                        WaitForSingleObject(_childInfo.hProcess, 300);
                    }
                    catch
                    {
                    }
                }
            }
        }
        catch
        {
        }

        try
        {
            if (_ptyOutputRead != IntPtr.Zero)
            {
                CloseHandle(_ptyOutputRead);
                _ptyOutputRead = IntPtr.Zero;
            }
        }
        catch
        {
        }

        try
        {
            if (_pty != IntPtr.Zero)
            {
                ClosePseudoConsole(_pty);
                _pty = IntPtr.Zero;
            }
        }
        catch
        {
        }

        try
        {
            if (_childInfo.hProcess != IntPtr.Zero)
            {
                CloseHandle(_childInfo.hProcess);
                _childInfo.hProcess = IntPtr.Zero;
            }
        }
        catch
        {
        }

        try
        {
            if (_readThread != null && _readThread.IsAlive && Thread.CurrentThread != _readThread)
            {
                _readThread.Join(250);
            }
        }
        catch
        {
        }
        _readThread = null;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    private static void NativeShowWindow(IntPtr hWnd, int cmd)
    {
        try
        {
            ShowWindow(hWnd, cmd);
        }
        catch
        {
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct COORD
    {
        public short X;
        public short Y;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    private const int PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016;
    private const uint HANDLE_FLAG_INHERIT = 0x00000001;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CreatePipe(
        out IntPtr hReadPipe,
        out IntPtr hWritePipe,
        IntPtr lpPipeAttributes,
        int nSize
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetHandleInformation(
        IntPtr hObject,
        uint dwMask,
        uint dwFlags
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern int CreatePseudoConsole(
        COORD size,
        IntPtr hInput,
        IntPtr hOutput,
        uint dwFlags,
        out IntPtr phPC
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern void ClosePseudoConsole(IntPtr hPC);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(
        IntPtr lpAttributeList,
        int dwAttributeCount,
        int dwFlags,
        ref IntPtr lpSize
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(
        IntPtr lpAttributeList,
        uint dwFlags,
        IntPtr Attribute,
        IntPtr lpValue,
        IntPtr cbSize,
        IntPtr lpPreviousValue,
        IntPtr lpReturnSize
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern void DeleteProcThreadAttributeList(IntPtr lpAttributeList);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessW(
        string lpApplicationName,
        StringBuilder lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFOEX lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ReadFile(
        IntPtr hFile,
        byte[] lpBuffer,
        int nNumberOfBytesToRead,
        out int lpNumberOfBytesRead,
        IntPtr lpOverlapped
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool WriteFile(
        IntPtr hFile,
        byte[] lpBuffer,
        int nNumberOfBytesToWrite,
        out int lpNumberOfBytesWritten,
        IntPtr lpOverlapped
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);
}
