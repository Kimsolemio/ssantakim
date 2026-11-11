using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using MouseBridge.Core;

namespace MouseBridge.App
{
    /// <summary>
    /// Mirrors the clipboard between the two PCs. Text and images are pushed immediately.
    /// Copied files are only announced; the other PC advertises them on its clipboard and
    /// downloads them when the cursor arrives (or at the latest when the user pastes).
    /// All methods run on the UI thread.
    /// </summary>
    sealed class ClipboardSync
    {
        const int MaxTextChars = 4 * 1024 * 1024;
        const int MaxImageBytes = 48 * 1024 * 1024;
        const long PrefetchLimit = 4L * 1024 * 1024 * 1024;

        readonly Form _host; readonly LinkManager _link; readonly OfferRegistry _offers;
        readonly Func<Guid, Action<long, long>, string[]> _fetchFiles;
        readonly System.Windows.Forms.Timer _debounce = new System.Windows.Forms.Timer { Interval = 150 };
        readonly uint _cfPreferredEffect = Native.RegisterClipboardFormat("Preferred DropEffect");
        uint _ignoreSeq;
        Guid _remoteOffer; long _remoteSize; Task<string[]> _fetch;

        public ClipboardSync(Form host, LinkManager link, OfferRegistry offers, Func<Guid, Action<long, long>, string[]> fetchFiles)
        {
            _host = host; _link = link; _offers = offers; _fetchFiles = fetchFiles;
            _debounce.Tick += (s, e) => { _debounce.Stop(); SendLocal(); };
        }

        public void Attach()
        {
            if (!Native.AddClipboardFormatListener(_host.Handle))
                Log.Write("clipboard listener failed: " + Marshal.GetLastWin32Error());
        }

        /// <summary>Called from the host window's WndProc.</summary>
        public void HandleMessage(ref Message m)
        {
            switch (m.Msg)
            {
                case Native.WM_CLIPBOARDUPDATE:
                    if (Native.GetClipboardSequenceNumber() == _ignoreSeq) break; // our own write
                    _debounce.Stop(); _debounce.Start();
                    break;
                case Native.WM_RENDERFORMAT:
                    if ((uint)m.WParam.ToInt64() == Native.CF_HDROP) RenderFiles();
                    break;
                case Native.WM_DESTROYCLIPBOARD:
                    _remoteOffer = Guid.Empty; _fetch = null; // someone copied something else
                    break;
            }
        }

        void SendLocal()
        {
            if (!_link.IsConnected) return;
            if (_remoteOffer != Guid.Empty && Native.GetClipboardOwner() == _host.Handle) return; // still the peer's files
            try
            {
                if (Clipboard.ContainsFileDropList())
                {
                    var list = Clipboard.GetFileDropList();
                    var paths = new string[list.Count];
                    list.CopyTo(paths, 0);
                    if (paths.Length == 0) return;
                    Guid id = _offers.Add(paths);
                    ThreadPool.QueueUserWorkItem(_ =>
                    {
                        FileTransfer.Measure(paths, out long total, out int count);
                        _link.Send(new Msg(MsgType.ClipFiles) { Offer = id, Size = total, A = count });
                    });
                }
                else if (Clipboard.ContainsText())
                {
                    string text = Clipboard.GetText();
                    if (text.Length > 0 && text.Length <= MaxTextChars)
                        _link.Send(new Msg(MsgType.ClipText) { Text = text });
                }
                else if (Clipboard.ContainsImage())
                {
                    using (var img = Clipboard.GetImage())
                    using (var ms = new MemoryStream())
                    {
                        if (img == null) return;
                        img.Save(ms, ImageFormat.Png);
                        if (ms.Length <= MaxImageBytes)
                            _link.Send(new Msg(MsgType.ClipImage) { Data = ms.ToArray() });
                    }
                }
            }
            catch (Exception ex) { Log.Write("clipboard read: " + ex.Message); }
        }

        public void ApplyRemoteText(string text)
        {
            if (string.IsNullOrEmpty(text)) return;
            try
            {
                Clipboard.SetDataObject(text, true, 8, 60);
                _ignoreSeq = Native.GetClipboardSequenceNumber();
            }
            catch (Exception ex) { Log.Write("clipboard text: " + ex.Message); }
        }

        public void ApplyRemoteImage(byte[] png)
        {
            try
            {
                using (var ms = new MemoryStream(png))
                using (var img = Image.FromStream(ms))
                using (var bmp = new Bitmap(img))
                {
                    Clipboard.SetDataObject(bmp, true, 8, 60);
                    _ignoreSeq = Native.GetClipboardSequenceNumber();
                }
            }
            catch (Exception ex) { Log.Write("clipboard image: " + ex.Message); }
        }

        /// <summary>Advertise the peer's copied files without transferring anything yet.</summary>
        public void ApplyRemoteFiles(Guid offer, long totalBytes)
        {
            bool open = false;
            for (int i = 0; i < 8 && !(open = Native.OpenClipboard(_host.Handle)); i++) Thread.Sleep(40);
            if (!open) { Log.Write("clipboard busy; file offer dropped"); return; }
            try
            {
                Native.EmptyClipboard(); // clears any previous offer via WM_DESTROYCLIPBOARD
                Native.SetClipboardData(Native.CF_HDROP, IntPtr.Zero); // rendered on demand
                IntPtr h = Native.GlobalAlloc(0x42, new UIntPtr(4));
                IntPtr p = Native.GlobalLock(h);
                Marshal.WriteInt32(p, 1); // DROPEFFECT_COPY
                Native.GlobalUnlock(h);
                if (Native.SetClipboardData(_cfPreferredEffect, h) == IntPtr.Zero) Native.GlobalFree(h);
            }
            finally { Native.CloseClipboard(); }
            _remoteOffer = offer; _remoteSize = totalBytes; _fetch = null;
            _ignoreSeq = Native.GetClipboardSequenceNumber();
        }

        /// <summary>The cursor just arrived on this PC: start downloading so a paste is instant.</summary>
        public void OnCursorArrived()
        {
            if (_remoteOffer != Guid.Empty && _fetch == null && _remoteSize <= PrefetchLimit) StartFetch();
        }

        void StartFetch()
        {
            Guid id = _remoteOffer;
            _fetch = Task.Run(() => _fetchFiles(id, null));
        }

        void RenderFiles()
        {
            if (_remoteOffer == Guid.Empty) return;
            if (_fetch == null) StartFetch();
            string[] paths;
            try { paths = _fetch.Result; } // the pasting app waits here until the files are local
            catch (Exception ex)
            {
                Log.Write("file paste failed: " + (ex.InnerException ?? ex).Message);
                _fetch = null;
                return;
            }
            if (paths.Length == 0) return;
            IntPtr h = BuildDropList(paths);
            if (Native.SetClipboardData(Native.CF_HDROP, h) == IntPtr.Zero) Native.GlobalFree(h);
        }

        static IntPtr BuildDropList(IEnumerable<string> paths)
        {
            var sb = new StringBuilder();
            foreach (var p in paths) sb.Append(p).Append('\0');
            sb.Append('\0');
            byte[] names = Encoding.Unicode.GetBytes(sb.ToString());
            const int header = 20; // DROPFILES
            IntPtr h = Native.GlobalAlloc(0x42, new UIntPtr((uint)(header + names.Length)));
            IntPtr p0 = Native.GlobalLock(h);
            Marshal.WriteInt32(p0, 0, header);  // pFiles: offset of the name list
            Marshal.WriteInt32(p0, 16, 1);      // fWide: UTF-16 names
            Marshal.Copy(names, 0, IntPtr.Add(p0, header), names.Length);
            Native.GlobalUnlock(h);
            return h;
        }
    }
}
