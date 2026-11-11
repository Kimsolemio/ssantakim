using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Windows.Forms;
using MouseBridge.Core;

namespace MouseBridge.App
{
    enum Mode
    {
        Local,        // this PC's mouse and keyboard act on this PC
        Controlling,  // this PC's mouse and keyboard are forwarded to the other PC
        Controlled,   // the other PC's mouse and keyboard are replayed here
    }

    /// <summary>
    /// Decides which PC the mouse is on. Three threads meet here: the hook thread (physical
    /// input), the network reader (messages from the peer) and the UI thread (drag windows).
    /// All shared state is guarded by <see cref="_g"/>; UI work is always posted, never awaited.
    /// </summary>
    sealed class Bridge
    {
        readonly object _g = new object();
        readonly Config _cfg;
        readonly LinkManager _link;
        readonly OfferRegistry _offers = new OfferRegistry();
        readonly Form _ui;
        readonly EdgeStrip _strip = new EdgeStrip();
        readonly DragProxy _proxy = new DragProxy();
        readonly CursorHider _hider = new CursorHider();
        readonly InputHook _hook = new InputHook();
        public readonly ClipboardSync Clipboard;

        volatile Mode _mode = Mode.Local;
        Native.POINT _center;            // where the local cursor is parked while Controlling
        bool _parked; DateTime _parkAt;  // has the cursor actually reached the parking spot yet
        bool _userLeft;                  // is the person holding the left button (wherever they are)
        bool _anyLeft; Native.POINT _downPt; volatile bool _stripShown;   // hook thread only (no lock)
        volatile bool _handover; DateTime _handoverAt;   // a file drag is being passed across the edge
        double _vx, _vy; bool _resync = true;   // cursor position while Controlled
        int _injButtons; readonly HashSet<long> _injKeys = new HashSet<long>();
        bool _dragPending;               // files for an incoming drag are still downloading
        bool _ctrl, _alt;
        string _peerName = "";
        LinkStatus _status = LinkStatus.Searching;

        public event Action StateChanged;
        public event Action<string> Notify;

        public Bridge(Config cfg, Form ui)
        {
            _cfg = cfg; _ui = ui;
            _link = new LinkManager(new LinkOptions
            {
                Id = cfg.Id,
                Code = () => _cfg.Code,
                ManualAddress = () => _cfg.ManualAddress,
                Log = Log.Write,
            });
            _link.ResolveOffer = _offers.Resolve;
            _link.Connected += OnConnected;
            _link.Disconnected += OnDisconnected;
            _link.Received += OnMessage;
            _link.StatusChanged += s => { _status = s; StateChanged?.Invoke(); };
            Clipboard = new ClipboardSync(ui, _link, _offers, Fetch);

            _strip.DragEnter += StripDragEnter;
            _strip.DragOver += (s, e) => e.Effect = HasFiles(e) ? DragDropEffects.Copy : DragDropEffects.None;
            _strip.DragLeave += (s, e) => { lock (_g) _handover = false; };
            _strip.DragDrop += StripDragDrop;

            _hook.Mouse = OnMouse;
            _hook.Key = OnKey;
        }

        public void Start()
        {
            Clipboard.Attach();
            _link.Start();
            _hook.Start();
        }

        public void Stop() => _link.Dispose();

        public string StatusText
        {
            get
            {
                if (_link.IsConnected)
                    return "연결됨: " + (_peerName.Length > 0 ? _peerName : "상대 PC") +
                           " (" + (_cfg.PeerSide == Side.Right ? "오른쪽" : "왼쪽") + ")";
                return _status == LinkStatus.CodeMismatch ? "연결 코드가 서로 다릅니다" : "상대 PC를 찾는 중…";
            }
        }

        public void ApplySettings(string code, Side side, string manual)
        {
            bool relink = code != _cfg.Code || manual != _cfg.ManualAddress;
            _cfg.Code = code; _cfg.ManualAddress = manual; _cfg.PeerSide = side;
            _cfg.Save();
            if (relink) _link.Reconnect();
            else _link.Send(new Msg(MsgType.Layout) { A = (int)side });
            StateChanged?.Invoke();
        }

        void Post(Action a)
        {
            try { if (_ui.IsHandleCreated) _ui.BeginInvoke(a); }
            catch (Exception) { }
        }

        string[] Fetch(Guid offer, Action<long, long> progress)
        {
            string dir = Path.Combine(Received.TempRoot, offer.ToString("N"));
            using (var ch = _link.OpenFileChannel(offer))
                return FileTransfer.Receive(ch, dir, progress);
        }

        // ---------------------------------------------------------------- connection

        void OnConnected()
        {
            _link.Send(new Msg(MsgType.Hello) { Text = Environment.MachineName, A = (int)_cfg.PeerSide });
            Log.Write("connected");
        }

        void OnDisconnected()
        {
            lock (_g)
            {
                _mode = Mode.Local;       // never leave the mouse stranded on a PC we cannot reach
                ReleaseInjected();
                _handover = false;
            }
            _peerName = "";
            Post(() => { _hider.Release(); _strip.Hide(); });
            Log.Write("disconnected");
            StateChanged?.Invoke();
        }

        // ---------------------------------------------------------------- physical input (hook thread)

        bool OnMouse(int msg, Native.MSLLHOOKSTRUCT m)
        {
            bool injected = (m.flags & Native.LLMHF_INJECTED) != 0;
            if (injected || _mode != Mode.Controlling) TrackDrag(msg, m);
            if (injected) return false; // replayed peer input: never block on the lock for these

            lock (_g)
            {
                if (_mode == Mode.Controlling) return ForwardMouse(msg, m);
                if (msg == Native.WM_LBUTTONUP) _userLeft = false;
                if (_mode == Mode.Controlled) _resync = true; // someone used this PC's own mouse

                if (msg == Native.WM_MOUSEMOVE && _link.IsConnected && !_dragPending && !HandoverActive())
                {
                    var v = Native.VirtualScreen();
                    if (EdgeMath.AtEdge(v, _cfg.PeerSide, m.pt.X) && !Native.AnyMouseButtonDown())
                    {
                        double ratio = EdgeMath.Ratio(v, m.pt.Y);
                        if (_mode == Mode.Controlled)
                        {
                            // This PC's own mouse takes over: end the peer's control first.
                            ReleaseInjected();
                            _link.Send(new Msg(MsgType.Leave) { Ratio = ratio });
                        }
                        BeginControl(ratio, Guid.Empty);
                        return true;
                    }
                }
                return false;
            }
        }

        /// <summary>
        /// Shows the edge drop target only while something is being dragged. Runs on the hook
        /// thread for every mouse event (physical or replayed) and takes no lock.
        /// </summary>
        void TrackDrag(int msg, Native.MSLLHOOKSTRUCT m)
        {
            if (msg == Native.WM_LBUTTONDOWN) { _anyLeft = true; _downPt = m.pt; }
            else if (msg == Native.WM_LBUTTONUP)
            {
                _anyLeft = false;
                if (_stripShown)
                {
                    _stripShown = false;
                    // During a handover the drop is still on its way to the strip; otherwise get out of the way now.
                    Post(() => { if (_handover) _strip.HideLater(); else _strip.Hide(); });
                }
            }
            else if (msg == Native.WM_MOUSEMOVE && _anyLeft && !_stripShown && _link.IsConnected
                     && Math.Abs(m.pt.X - _downPt.X) + Math.Abs(m.pt.Y - _downPt.Y) > 12)
            {
                _stripShown = true;
                Side side = _cfg.PeerSide;
                Post(() => _strip.ShowAt(side));
            }
        }

        bool HandoverActive()
        {
            if (_handover && (DateTime.UtcNow - _handoverAt).TotalSeconds > 1.5) _handover = false;
            return _handover;
        }

        /// <summary>Caller holds the lock.</summary>
        void BeginControl(double ratio, Guid dragOffer)
        {
            _mode = Mode.Controlling;
            _userLeft = dragOffer != Guid.Empty;
            // Park the cursor mid-screen: swallowed moves are then reported relative to it.
            _center = new Native.POINT { X = Native.GetSystemMetrics(0) / 2, Y = Native.GetSystemMetrics(1) / 2 };
            _parked = false; _parkAt = DateTime.UtcNow;
            Injector.Warp(_center.X, _center.Y);
            _link.Send(new Msg(MsgType.Enter) { Ratio = ratio, Offer = dragOffer, A = _userLeft ? 1 : 0 });
            int cx = _center.X, cy = _center.Y;
            Post(() => _hider.Engage(cx, cy));
        }

        /// <summary>Caller holds the lock. Returns true to keep the event away from this PC.</summary>
        bool ForwardMouse(int msg, Native.MSLLHOOKSTRUCT m)
        {
            int hi = (short)(m.mouseData >> 16);
            switch (msg)
            {
                case Native.WM_MOUSEMOVE:
                    int dx = m.pt.X - _center.X, dy = m.pt.Y - _center.Y;
                    if (dx == 0 && dy == 0) { _parked = true; return false; }
                    if (!_parked)
                    {
                        // Until the cursor has really reached the parking spot, distances from it mean nothing.
                        if (Native.GetCursorPos(out var cur) && cur.X == _center.X && cur.Y == _center.Y) _parked = true;
                        else
                        {
                            if ((DateTime.UtcNow - _parkAt).TotalMilliseconds > 200)
                            {
                                _parkAt = DateTime.UtcNow;
                                Injector.Warp(_center.X, _center.Y);
                            }
                            return true;
                        }
                    }
                    _link.Send(new Msg(MsgType.MouseMove) { A = dx, B = dy });
                    return true;
                case Native.WM_LBUTTONDOWN: _userLeft = true; SendButton(0, true); return true;
                case Native.WM_LBUTTONUP: _userLeft = false; SendButton(0, false); return true;
                case Native.WM_RBUTTONDOWN: SendButton(1, true); return true;
                case Native.WM_RBUTTONUP: SendButton(1, false); return true;
                case Native.WM_MBUTTONDOWN: SendButton(2, true); return true;
                case Native.WM_MBUTTONUP: SendButton(2, false); return true;
                case Native.WM_XBUTTONDOWN: SendButton(hi == 2 ? 4 : 3, true); return true;
                case Native.WM_XBUTTONUP: SendButton(hi == 2 ? 4 : 3, false); return true;
                case Native.WM_MOUSEWHEEL: _link.Send(new Msg(MsgType.MouseWheel) { A = hi }); return true;
                case Native.WM_MOUSEHWHEEL: _link.Send(new Msg(MsgType.MouseWheel) { A = hi, B = 1 }); return true;
            }
            return true;
        }

        void SendButton(int button, bool down)
            => _link.Send(new Msg(MsgType.MouseButton) { A = button, B = down ? 1 : 0 });

        bool OnKey(Native.KBDLLHOOKSTRUCT k)
        {
            if ((k.flags & Native.LLKHF_INJECTED) != 0) return false;
            bool up = (k.flags & Native.LLKHF_UP) != 0;
            if (k.vkCode == 0xA2 || k.vkCode == 0xA3 || k.vkCode == 0x11) _ctrl = !up;
            if (k.vkCode == 0xA4 || k.vkCode == 0xA5 || k.vkCode == 0x12) _alt = !up;
            lock (_g)
            {
                if (_mode != Mode.Controlling) return false;
                if (!up && k.vkCode == Native.VK_HOME && _ctrl && _alt)
                {
                    // Emergency exit: Ctrl+Alt+Home always brings the mouse back to this PC.
                    _mode = Mode.Local;
                    _link.Send(new Msg(MsgType.ReleaseAll));
                    Post(_hider.Release);
                    return true;
                }
                bool ext = (k.flags & Native.LLKHF_EXTENDED) != 0;
                _link.Send(new Msg(MsgType.Key) { A = (int)k.scanCode, B = (ext ? 1 : 0) | (up ? 0 : 2), C = (int)k.vkCode });
                return true;
            }
        }

        // ---------------------------------------------------------------- messages from the peer (network thread)

        void OnMessage(Msg m)
        {
            switch (m.Type)
            {
                case MsgType.Hello:
                    _peerName = m.Text ?? "";
                    // Screens must face each other; the PC with the smaller id decides.
                    if (_link.Id.CompareTo(_link.PeerId) > 0) AdoptOpposite((Side)m.A);
                    StateChanged?.Invoke();
                    break;
                case MsgType.Layout:
                    AdoptOpposite((Side)m.A);
                    StateChanged?.Invoke();
                    break;
                case MsgType.Enter: OnEnter(m); break;
                case MsgType.Leave: OnLeave(m); break;
                case MsgType.MouseMove: OnRemoteMove(m.A, m.B); break;
                case MsgType.MouseButton: OnRemoteButton(m.A, m.B != 0); break;
                case MsgType.MouseWheel:
                    lock (_g) if (_mode == Mode.Controlled) Injector.Wheel(m.A, m.B != 0);
                    break;
                case MsgType.Key: OnRemoteKey(m); break;
                case MsgType.ReleaseAll:
                    lock (_g) if (_mode == Mode.Controlled) { _mode = Mode.Local; ReleaseInjected(); }
                    break;
                case MsgType.ClipText: { string t = m.Text; Post(() => Clipboard.ApplyRemoteText(t)); break; }
                case MsgType.ClipImage: { byte[] d = m.Data; Post(() => Clipboard.ApplyRemoteImage(d)); break; }
                case MsgType.ClipFiles: { Guid o = m.Offer; long sz = m.Size; Post(() => Clipboard.ApplyRemoteFiles(o, sz)); break; }
            }
        }

        void AdoptOpposite(Side peerView)
        {
            Side mine = EdgeMath.Opposite(peerView == Side.Left ? Side.Left : Side.Right);
            if (_cfg.PeerSide != mine) { _cfg.PeerSide = mine; _cfg.Save(); }
        }

        void OnEnter(Msg m)
        {
            lock (_g)
            {
                if (_mode == Mode.Controlling) Post(_hider.Release);
                _mode = Mode.Controlled;
                var v = Native.VirtualScreen();
                EdgeMath.EntryPoint(v, _cfg.PeerSide, m.Ratio, out int x, out int y);
                _vx = x; _vy = y; _resync = false;
                Injector.MoveTo(x, y);
                _userLeft = m.A != 0;
                if (m.Offer != Guid.Empty) StartIncomingDrag(m.Offer);
            }
            Post(Clipboard.OnCursorArrived);
        }

        void OnLeave(Msg m)
        {
            lock (_g)
            {
                if (_mode != Mode.Controlling) return;
                _mode = Mode.Local;
                var v = Native.VirtualScreen();
                EdgeMath.EntryPoint(v, _cfg.PeerSide, m.Ratio, out int x, out int y);
                Injector.Warp(x, y);
                if (m.Offer != Guid.Empty) StartIncomingDrag(m.Offer);
            }
            Post(_hider.Release);
            Post(Clipboard.OnCursorArrived);
        }

        void OnRemoteMove(int dx, int dy)
        {
            lock (_g)
            {
                if (_mode != Mode.Controlled) return;
                if (_resync && Native.GetCursorPos(out var cur)) { _vx = cur.X; _vy = cur.Y; _resync = false; }
                var v = Native.VirtualScreen();
                double nx = _vx + dx, ny = _vy + dy;
                if (EdgeMath.Beyond(v, _cfg.PeerSide, nx) && _injButtons == 0 && !_dragPending && !HandoverActive())
                {
                    // Pushed past the edge that faces the controlling PC: hand the cursor back.
                    _mode = Mode.Local;
                    ReleaseInjected();
                    _link.Send(new Msg(MsgType.Leave) { Ratio = EdgeMath.Ratio(v, (int)ny) });
                    return;
                }
                _vx = EdgeMath.Clamp(nx, v.Left, v.Right - 1);
                _vy = EdgeMath.Clamp(ny, v.Top, v.Bottom - 1);
                Injector.MoveTo((int)_vx, (int)_vy);
            }
        }

        void OnRemoteButton(int button, bool down)
        {
            lock (_g)
            {
                if (_mode != Mode.Controlled) return;
                if (button == 0)
                {
                    _userLeft = down;
                    if (_dragPending) return; // the drag has not started here yet; nothing to press or release
                }
                if (down) _injButtons |= 1 << button; else _injButtons &= ~(1 << button);
                Injector.Button(button, down);
            }
        }

        void OnRemoteKey(Msg m)
        {
            lock (_g)
            {
                if (_mode != Mode.Controlled) return;
                bool ext = (m.B & 1) != 0, down = (m.B & 2) != 0;
                long id = ((long)m.C << 32) | ((long)(ext ? 1 : 0) << 31) | (uint)(m.A & 0x7FFFFFFF);
                if (down) _injKeys.Add(id); else _injKeys.Remove(id);
                Injector.Key(m.A, ext, down, m.C);
            }
        }

        /// <summary>Caller holds the lock. Lets go of everything the peer was holding down here.</summary>
        void ReleaseInjected()
        {
            for (int b = 0; b < 5; b++)
                if ((_injButtons & (1 << b)) != 0) Injector.Button(b, false);
            _injButtons = 0;
            foreach (long id in _injKeys)
                Injector.Key((int)(id & 0x7FFFFFFF), ((id >> 31) & 1) != 0, false, (int)(id >> 32));
            _injKeys.Clear();
        }

        // ---------------------------------------------------------------- file drag across the edge (UI thread)

        static bool HasFiles(DragEventArgs e) => e.Data != null && e.Data.GetDataPresent(DataFormats.FileDrop);

        void StripDragEnter(object sender, DragEventArgs e)
        {
            if (!HasFiles(e)) { e.Effect = DragDropEffects.None; return; }
            e.Effect = DragDropEffects.Copy;
            lock (_g)
            {
                if (_handover || _mode == Mode.Controlling) return;
                _handover = true; _handoverAt = DateTime.UtcNow;
                // Finish the drag on this PC by "dropping" it on the strip; the person is still
                // holding the real button and the drag continues on the other PC.
                _injButtons &= ~1;
                Injector.Button(0, false);
            }
        }

        void StripDragDrop(object sender, DragEventArgs e)
        {
            var paths = e.Data.GetData(DataFormats.FileDrop) as string[];
            e.Effect = DragDropEffects.Copy;
            _strip.Hide();
            lock (_g)
            {
                _handover = false; _stripShown = false;
                if (paths == null || paths.Length == 0 || !_link.IsConnected) return;
                Guid offer = _offers.Add(paths);
                var v = Native.VirtualScreen();
                double ratio = EdgeMath.Ratio(v, Cursor.Position.Y);
                if (_mode == Mode.Local) BeginControl(ratio, offer);
                else if (_mode == Mode.Controlled)
                {
                    _mode = Mode.Local;
                    ReleaseInjected();
                    _link.Send(new Msg(MsgType.Leave) { Ratio = ratio, Offer = offer });
                }
            }
        }

        /// <summary>Caller holds the lock. The cursor arrived carrying files: download, then continue the drag here.</summary>
        void StartIncomingDrag(Guid offer)
        {
            _dragPending = true;
            Post(() => _proxy.ShowProgress("파일 받는 중…"));
            ThreadPool.QueueUserWorkItem(_ =>
            {
                string[] paths = null; Exception error = null; int last = -1;
                try
                {
                    paths = Fetch(offer, (done, total) =>
                    {
                        int pct = total > 0 ? (int)(done * 100 / total) : 0;
                        if (pct == last) return;
                        last = pct;
                        Post(() => _proxy.SetText("파일 받는 중… " + pct + "%"));
                    });
                }
                catch (Exception ex) { error = ex; }
                Post(() => FinishIncomingDrag(paths, error));
            });
        }

        void FinishIncomingDrag(string[] paths, Exception error)
        {
            if (error != null || paths == null || paths.Length == 0)
            {
                lock (_g) _dragPending = false;
                _proxy.Cancel();
                Log.Write("drag receive failed: " + (error?.Message ?? "no files"));
                Notify?.Invoke("파일을 받지 못했습니다.");
                return;
            }
            _proxy.Launch(paths,
                stillHeld: () => { lock (_g) return _userLeft && _mode != Mode.Controlling; },
                injectDown: () =>
                {
                    lock (_g)
                    {
                        _dragPending = false;
                        if (_mode == Mode.Controlled) _injButtons |= 1;
                        Injector.Button(0, true);
                        if (!_userLeft) { _injButtons &= ~1; Injector.Button(0, false); } // released at the last moment
                    }
                },
                fallback: KeepInDownloads);
        }

        void KeepInDownloads(string[] paths)
        {
            lock (_g) _dragPending = false;
            int n = Received.Keep(paths);
            if (n > 0) Notify?.Invoke("받은 파일 " + n + "개를 다운로드\\MouseBridge 폴더에 저장했습니다.");
        }
    }
}
