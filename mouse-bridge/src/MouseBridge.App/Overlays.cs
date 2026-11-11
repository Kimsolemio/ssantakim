using System;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Windows.Forms;
using MouseBridge.Core;

namespace MouseBridge.App
{
    /// <summary>Borderless always-on-top helper window that never takes keyboard focus.</summary>
    class OverlayForm : Form
    {
        public OverlayForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            AutoScaleMode = AutoScaleMode.None;
            TopMost = true;
        }

        protected override bool ShowWithoutActivation => true;

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= Native.WS_EX_TOPMOST | Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE;
                return cp;
            }
        }
    }

    /// <summary>
    /// A thin, nearly invisible drop target along the screen edge that faces the other PC.
    /// It is only shown while a mouse drag is in progress, so it never blocks normal clicks.
    /// Dragging files into it is how a drag "crosses" to the other PC.
    /// </summary>
    sealed class EdgeStrip : OverlayForm
    {
        readonly Timer _hideTimer = new Timer { Interval = 500 };

        public EdgeStrip()
        {
            AllowDrop = true;
            BackColor = Color.Black;
            Opacity = 0.01;
            _hideTimer.Tick += (s, e) => { _hideTimer.Stop(); Hide(); };
        }

        public void ShowAt(Side side)
        {
            _hideTimer.Stop();
            var v = Native.VirtualScreen();
            const int w = 4;
            Bounds = new Rectangle(side == Side.Right ? v.Right - w : v.Left, v.Top, w, v.Height);
            if (!Visible) Show();
        }

        /// <summary>Hide a little later, so a drop that is still being delivered is not lost.</summary>
        public void HideLater() { _hideTimer.Stop(); _hideTimer.Start(); }
    }

    /// <summary>
    /// Shown on the receiving PC during a cross-PC file drag: first a small progress label next
    /// to the cursor, then (once the files have arrived) a tiny window under the cursor that
    /// starts a real Windows drag, so the files can be dropped on any folder or app.
    /// </summary>
    sealed class DragProxy : OverlayForm
    {
        readonly Label _label = new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter, ForeColor = Color.White };
        readonly Timer _follow = new Timer { Interval = 30 };
        readonly Timer _arm = new Timer { Interval = 80 };
        readonly Timer _watchdog = new Timer { Interval = 800 };
        string[] _paths; bool _armed;
        Func<bool> _stillHeld; Action _injectDown; Action<string[]> _fallback;

        public DragProxy()
        {
            BackColor = Color.FromArgb(40, 40, 48);
            Font = new Font("Malgun Gothic", 9f);
            Controls.Add(_label);
            _follow.Tick += (s, e) => { var p = Cursor.Position; Location = new Point(p.X + 18, p.Y + 18); };
            _arm.Tick += (s, e) => Arm();
            _watchdog.Tick += (s, e) => GiveUp();
        }

        public void ShowProgress(string text)
        {
            StopTimers(); _armed = false;
            _label.Visible = true; _label.Text = text;
            Opacity = 0.92;
            var p = Cursor.Position;
            Bounds = new Rectangle(p.X + 18, p.Y + 18, 210, 32);
            _follow.Start();
            if (!Visible) Show();
        }

        public void SetText(string text) { if (_label.Visible) _label.Text = text; }

        public void Cancel() { StopTimers(); _armed = false; Hide(); }

        public void Launch(string[] paths, Func<bool> stillHeld, Action injectDown, Action<string[]> fallback)
        {
            StopTimers();
            _paths = paths; _stillHeld = stillHeld; _injectDown = injectDown; _fallback = fallback;
            _label.Visible = false;
            Opacity = 0.01;
            var p = Cursor.Position;
            Bounds = new Rectangle(p.X - 10, p.Y - 10, 21, 21);
            if (!Visible) Show();
            _arm.Start(); // give the window a moment to appear under the cursor
        }

        void Arm()
        {
            _arm.Stop();
            if (!_stillHeld()) { Hide(); _fallback(_paths); return; }
            var p = Cursor.Position;
            Bounds = new Rectangle(p.X - 10, p.Y - 10, 21, 21);
            _armed = true;
            _watchdog.Start();
            _injectDown(); // lands on this window -> OnMouseDown starts the drag
        }

        void GiveUp()
        {
            _watchdog.Stop();
            if (!_armed) return;
            _armed = false;
            Injector.Button(0, false);
            Hide();
            _fallback(_paths);
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (!_armed || e.Button != MouseButtons.Left) return;
            _armed = false; _watchdog.Stop();
            Capture = false;
            Hide();
            var data = new DataObject(DataFormats.FileDrop, _paths);
            var effect = DoDragDrop(data, DragDropEffects.Copy | DragDropEffects.Move);
            if (effect == DragDropEffects.None) _fallback(_paths); // dropped nowhere useful: keep the files
        }

        void StopTimers() { _follow.Stop(); _arm.Stop(); _watchdog.Stop(); }
    }

    /// <summary>Hides the local cursor while this PC's mouse is driving the other PC.</summary>
    sealed class CursorHider : OverlayForm
    {
        bool _hidden;
        public CursorHider() { BackColor = Color.Black; Opacity = 0.01; }

        public void Engage(int x, int y)
        {
            Bounds = new Rectangle(x - 3, y - 3, 7, 7);
            if (!Visible) Show();
            if (!_hidden) { Cursor.Hide(); _hidden = true; }
        }

        public void Release()
        {
            if (_hidden) { Cursor.Show(); _hidden = false; }
            if (Visible) Hide();
        }
    }

    static class Received
    {
        public static string Folder => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads", "MouseBridge");

        public static string TempRoot => Path.Combine(Path.GetTempPath(), "MouseBridge");

        /// <summary>Moves received items into Downloads\MouseBridge, never overwriting anything.</summary>
        public static int Keep(string[] paths)
        {
            int moved = 0;
            Directory.CreateDirectory(Folder);
            foreach (var p in paths.Where(x => File.Exists(x) || Directory.Exists(x)))
            {
                try
                {
                    string name = Path.GetFileName(p), stem = Path.GetFileNameWithoutExtension(p), ext = Path.GetExtension(p);
                    bool isDir = Directory.Exists(p);
                    string target = Path.Combine(Folder, name);
                    for (int i = 2; File.Exists(target) || Directory.Exists(target); i++)
                        target = Path.Combine(Folder, isDir ? name + " (" + i + ")" : stem + " (" + i + ")" + ext);
                    if (isDir) MoveDirectory(p, target); else File.Move(p, target);
                    moved++;
                }
                catch (Exception ex) { Log.Write("keep failed for " + p + ": " + ex.Message); }
            }
            return moved;
        }

        static void MoveDirectory(string from, string to)
        {
            try { Directory.Move(from, to); return; }
            catch (IOException) { } // different volume: copy then delete
            foreach (var dir in Directory.GetDirectories(from, "*", SearchOption.AllDirectories))
                Directory.CreateDirectory(Path.Combine(to, dir.Substring(from.Length).TrimStart('\\')));
            Directory.CreateDirectory(to);
            foreach (var file in Directory.GetFiles(from, "*", SearchOption.AllDirectories))
                File.Copy(file, Path.Combine(to, file.Substring(from.Length).TrimStart('\\')), false);
            Directory.Delete(from, true);
        }

        public static void CleanTemp()
        {
            try { if (Directory.Exists(TempRoot)) Directory.Delete(TempRoot, true); }
            catch (Exception) { }
        }
    }
}
