using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using MouseBridge.Core;

namespace MouseBridge.App
{
    /// <summary>
    /// "MouseBridge.exe --selftest out.txt": checks the Windows-specific plumbing (hooks, input
    /// replay, clipboard) on the machine it runs on and writes one line per check.
    /// </summary>
    static class SelfTest
    {
        public static int Run(string outFile)
        {
            var lines = new List<string>();
            int failures = 0;
            void Check(string name, Func<string> test)
            {
                string result;
                try { result = test(); }
                catch (Exception ex) { result = ex.GetType().Name + ": " + ex.Message; }
                if (result != null) failures++;
                lines.Add((result == null ? "PASS  " : "FAIL  ") + name + (result == null ? "" : "  -> " + result));
            }
            void Pump(int ms)
            {
                var end = DateTime.UtcNow.AddMilliseconds(ms);
                while (DateTime.UtcNow < end) { Application.DoEvents(); Thread.Sleep(5); }
            }

            Check("INPUT struct size", () =>
            {
                int size = Marshal.SizeOf(typeof(Native.INPUT)), want = IntPtr.Size == 8 ? 40 : 28;
                return size == want ? null : size + " != " + want;
            });

            int injectedMoves = 0, injectedKeys = 0, physical = 0;
            var hook = new InputHook();
            hook.Mouse = (msg, m) =>
            {
                if ((m.flags & Native.LLMHF_INJECTED) != 0) { if (msg == Native.WM_MOUSEMOVE) Interlocked.Increment(ref injectedMoves); }
                else Interlocked.Increment(ref physical);
                return false;
            };
            hook.Key = k => { if ((k.flags & Native.LLKHF_INJECTED) != 0) Interlocked.Increment(ref injectedKeys); return false; };
            hook.Start();
            Pump(500);

            var v = Native.VirtualScreen();
            Check("virtual screen has a size", () => v.Width > 0 && v.Height > 0 ? null : v.Width + "x" + v.Height);

            Check("replayed mouse move lands on the requested pixel and is seen by the hook as injected", () =>
            {
                foreach (var target in new[] { new[] { v.Left + 100, v.Top + 120 }, new[] { v.Left + v.Width / 2, v.Top + v.Height / 2 }, new[] { v.Right - 1, v.Bottom - 1 } })
                {
                    Injector.MoveTo(target[0], target[1]);
                    Pump(250);
                    Native.GetCursorPos(out var p);
                    if (Math.Abs(p.X - target[0]) > 1 || Math.Abs(p.Y - target[1]) > 1)
                        return "wanted " + target[0] + "," + target[1] + " got " + p.X + "," + p.Y;
                }
                return injectedMoves >= 3 ? null : "hook saw " + injectedMoves + " injected moves";
            });

            Check("cursor warp", () =>
            {
                Injector.Warp(v.Left + 50, v.Top + 60);
                Pump(250);
                Native.GetCursorPos(out var p);
                return p.X == v.Left + 50 && p.Y == v.Top + 60 ? null : "got " + p.X + "," + p.Y;
            });

            Check("replayed key press is seen by the hook as injected", () =>
            {
                Injector.Key(0x2A, false, true, 0xA0);  // left shift down
                Injector.Key(0x2A, false, false, 0xA0); // and up
                Pump(300);
                return injectedKeys >= 2 ? null : "hook saw " + injectedKeys + " injected key events";
            });

            var host = new HostWindow();
            var handle = host.Handle;
            var link = new LinkManager(new LinkOptions());
            string tempDir = Path.Combine(Path.GetTempPath(), "MouseBridge-selftest");
            Directory.CreateDirectory(tempDir);
            string f1 = Path.Combine(tempDir, "하나.txt"), f2 = Path.Combine(tempDir, "two.bin");
            File.WriteAllText(f1, "1"); File.WriteAllText(f2, "2");
            int fetches = 0;
            var clip = new ClipboardSync(host, link, new OfferRegistry(), (id, progress) => { Interlocked.Increment(ref fetches); Thread.Sleep(200); return new[] { f1, f2 }; });
            host.Clipboard = clip;
            clip.Attach();

            Check("peer text arrives on the clipboard", () =>
            {
                clip.ApplyRemoteText("마우스브릿지 selftest ✓");
                Pump(300);
                string got = Clipboard.GetText();
                return got == "마우스브릿지 selftest ✓" ? null : "got '" + got + "'";
            });

            Check("peer files are advertised lazily and delivered on paste", () =>
            {
                clip.ApplyRemoteFiles(Guid.NewGuid(), 2);
                Pump(300);
                if (fetches != 0) return "downloaded before anyone pasted";
                if (!Clipboard.ContainsFileDropList()) return "file list not on clipboard";
                var list = Clipboard.GetFileDropList(); // this is what a paste in Explorer does
                if (fetches != 1) return "fetch count " + fetches;
                if (list.Count != 2 || list[0] != f1 || list[1] != f2) return "wrong list: " + string.Join("|", new List<string>(ToArray(list)));
                return null;
            });

            Check("peer image arrives on the clipboard", () =>
            {
                using (var bmp = new System.Drawing.Bitmap(13, 7))
                using (var ms = new MemoryStream())
                {
                    bmp.SetPixel(3, 3, System.Drawing.Color.Red);
                    bmp.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
                    clip.ApplyRemoteImage(ms.ToArray());
                }
                Pump(300);
                using (var img = Clipboard.GetImage())
                    return img != null && img.Width == 13 && img.Height == 7 ? null : "image missing or wrong size";
            });

            Check("overlay windows can be created", () =>
            {
                using (var strip = new EdgeStrip())
                using (var proxy = new DragProxy())
                using (var hider = new CursorHider())
                {
                    strip.ShowAt(Side.Right); proxy.ShowProgress("test"); hider.Engage(v.Left + 200, v.Top + 200);
                    Pump(200);
                    bool ok = strip.Visible && strip.Bounds.Right == v.Right && strip.Bounds.Height == v.Height && proxy.Visible;
                    hider.Release(); proxy.Cancel(); strip.Hide();
                    return ok ? null : "strip bounds " + strip.Bounds;
                }
            });

            lines.Add("INFO  physical mouse events seen during test: " + physical);
            lines.Add("INFO  virtual screen " + v.Left + "," + v.Top + " " + v.Width + "x" + v.Height + ", " + (IntPtr.Size * 8) + "-bit");
            lines.Add(failures == 0 ? "RESULT ok" : "RESULT " + failures + " failed");
            File.WriteAllLines(outFile, lines);
            return failures;
        }

        static string[] ToArray(System.Collections.Specialized.StringCollection c)
        {
            var a = new string[c.Count];
            c.CopyTo(a, 0);
            return a;
        }
    }
}
