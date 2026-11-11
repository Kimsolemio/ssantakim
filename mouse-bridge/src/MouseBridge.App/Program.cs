using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Threading;
using System.Windows.Forms;
using MouseBridge.Core;

namespace MouseBridge.App
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            if (args.Length >= 2 && args[0] == "--selftest")
            {
                Native.EnableDpiAwareness();
                Environment.Exit(SelfTest.Run(args[1]));
            }
            using (var mutex = new Mutex(true, "MouseBridge.SingleInstance", out bool first))
            {
                if (!first)
                {
                    MessageBox.Show("MouseBridge가 이미 실행 중입니다. 작업 표시줄 오른쪽 아래 트레이 아이콘을 확인하세요.", "MouseBridge");
                    return;
                }
                Native.EnableDpiAwareness();
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.ThreadException += (s, e) => Log.Write("ui: " + e.Exception);
                AppDomain.CurrentDomain.UnhandledException += (s, e) => Log.Write("fatal: " + e.ExceptionObject);
                Received.CleanTemp();
                Application.Run(new TrayApp());
            }
        }
    }

    /// <summary>Invisible window that owns the clipboard listener and marshals work to the UI thread.</summary>
    sealed class HostWindow : Form
    {
        public ClipboardSync Clipboard;

        public HostWindow()
        {
            ShowInTaskbar = false;
            FormBorderStyle = FormBorderStyle.FixedToolWindow;
            StartPosition = FormStartPosition.Manual;
            Location = new Point(-32000, -32000);
        }

        protected override void WndProc(ref Message m)
        {
            Clipboard?.HandleMessage(ref m);
            base.WndProc(ref m);
        }
    }

    sealed class TrayApp : ApplicationContext
    {
        readonly Config _cfg;
        readonly HostWindow _host = new HostWindow();
        readonly Bridge _bridge;
        readonly NotifyIcon _tray;
        readonly ToolStripMenuItem _statusItem;
        SettingsForm _settings;

        public TrayApp()
        {
            bool firstRun = !Config.Exists;
            _cfg = Config.Load();
            var handle = _host.Handle; // create the window without showing it

            _bridge = new Bridge(_cfg, _host);
            _host.Clipboard = _bridge.Clipboard;

            _statusItem = new ToolStripMenuItem("시작하는 중…") { Enabled = false };
            var menu = new ContextMenuStrip();
            menu.Items.Add(_statusItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("설정…", null, (s, e) => ShowSettings());
            menu.Items.Add("받은 파일 폴더 열기", null, (s, e) => OpenFolder(Received.Folder));
            menu.Items.Add("로그 폴더 열기", null, (s, e) => OpenFolder(Path.GetDirectoryName(Log.FilePath)));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("종료", null, (s, e) => Exit());

            _tray = new NotifyIcon { Icon = MakeIcon(), Text = "MouseBridge", ContextMenuStrip = menu, Visible = true };
            _tray.DoubleClick += (s, e) => ShowSettings();

            _bridge.StateChanged += () => Ui(RefreshStatus);
            _bridge.Notify += text => Ui(() => _tray.ShowBalloonTip(4000, "MouseBridge", text, ToolTipIcon.Info));
            _bridge.Start();
            RefreshStatus();
            Log.Write("started, id " + _cfg.Id);
            if (firstRun) ShowSettings();
        }

        void Ui(Action a)
        {
            try { if (_host.IsHandleCreated) _host.BeginInvoke(a); } catch (Exception) { }
        }

        void RefreshStatus()
        {
            string s = _bridge.StatusText;
            _statusItem.Text = s;
            string tip = "MouseBridge - " + s;
            _tray.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip;
            _settings?.SetStatus(s);
        }

        void ShowSettings()
        {
            if (_settings == null || _settings.IsDisposed)
            {
                _settings = new SettingsForm(_cfg, _bridge);
                _settings.SetStatus(_bridge.StatusText);
            }
            _settings.Show();
            _settings.Activate();
        }

        static void OpenFolder(string path)
        {
            try { Directory.CreateDirectory(path); Process.Start("explorer.exe", "\"" + path + "\""); }
            catch (Exception ex) { Log.Write("open folder: " + ex.Message); }
        }

        void Exit()
        {
            _tray.Visible = false;
            _bridge.Stop();
            Application.Exit();
        }

        static Icon MakeIcon()
        {
            using (var bmp = new Bitmap(32, 32))
            {
                using (var g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.Clear(Color.Transparent);
                    using (var body = new SolidBrush(Color.FromArgb(52, 120, 246)))
                    using (var pen = new Pen(Color.White, 2f))
                    {
                        g.FillEllipse(body, 7, 2, 18, 28);   // mouse body
                        g.DrawLine(pen, 16, 3, 16, 13);      // button split
                        g.DrawLine(pen, 8, 13, 24, 13);
                    }
                }
                return Icon.FromHandle(bmp.GetHicon());
            }
        }
    }
}
