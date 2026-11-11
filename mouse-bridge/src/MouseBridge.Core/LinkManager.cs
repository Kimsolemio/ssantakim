using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Threading;

namespace MouseBridge.Core
{
    public sealed class LinkOptions
    {
        public Guid Id = Guid.NewGuid();
        public Func<string> Code = () => "";
        public Func<string> ManualAddress = () => "";   // "ip" or "ip:port"; empty = auto discovery
        public int TcpPort = 45655;
        public int UdpPort = 45654;
        public bool EnableDiscovery = true;
        public Action<string> Log = _ => { };
    }

    public enum LinkStatus { Searching, Connected, CodeMismatch }

    /// <summary>
    /// Keeps exactly one encrypted control connection to the other PC alive, whichever
    /// network path is available, and serves/opens extra connections for file streams.
    /// </summary>
    public sealed class LinkManager : IDisposable
    {
        readonly LinkOptions _o;
        readonly object _lock = new object();
        Session _current;
        TcpListener _listener;
        Discovery _discovery;
        volatile bool _stop;
        string _masterCode; byte[] _master;
        volatile bool _connecting;

        public event Action Connected;
        public event Action Disconnected;
        public event Action<Msg> Received;
        public event Action<LinkStatus> StatusChanged;
        /// <summary>Maps an offer id to local paths when the peer asks for the files.</summary>
        public Func<Guid, string[]> ResolveOffer = _ => null;

        public LinkManager(LinkOptions options) { _o = options; }

        public Guid Id => _o.Id;
        public bool IsConnected { get { lock (_lock) return _current != null; } }
        public Guid PeerId { get { lock (_lock) return _current?.Channel.PeerId ?? Guid.Empty; } }
        public int ListenPort => ((IPEndPoint)_listener.LocalEndpoint).Port;

        public void Start()
        {
            _listener = new TcpListener(IPAddress.Any, _o.TcpPort);
            _listener.Start();
            new Thread(AcceptLoop) { IsBackground = true, Name = "mb-accept" }.Start();
            if (_o.EnableDiscovery)
            {
                try
                {
                    _discovery = new Discovery(_o.Id, _o.UdpPort, ListenPort);
                    _discovery.Start();
                }
                catch (Exception ex) { _o.Log("discovery unavailable: " + ex.Message); }
            }
            new Thread(ConnectLoop) { IsBackground = true, Name = "mb-connect" }.Start();
        }

        byte[] Master()
        {
            string code = _o.Code() ?? "";
            lock (_lock)
            {
                if (_master == null || code != _masterCode)
                {
                    _master = SecureChannel.DeriveMaster(code);
                    _masterCode = code;
                }
                return _master;
            }
        }

        public void Send(Msg m)
        {
            Session s;
            lock (_lock) s = _current;
            s?.Enqueue(m.Encode());
        }

        /// <summary>Drops the current connection (e.g. after the pairing code changed).</summary>
        public void Reconnect()
        {
            Session s;
            lock (_lock) s = _current;
            s?.Close();
        }

        /// <summary>Opens a separate encrypted connection to the peer and requests the files of an offer.</summary>
        public SecureChannel OpenFileChannel(Guid offer)
        {
            IPEndPoint ep;
            lock (_lock)
            {
                if (_current == null) throw new InvalidOperationException("not connected");
                ep = _current.PeerListener;
            }
            var tcp = new TcpClient(AddressFamily.InterNetwork) { NoDelay = true };
            try
            {
                ConnectWithTimeout(tcp, ep, 3000);
                tcp.ReceiveTimeout = 30000; tcp.SendTimeout = 30000;
                var ch = SecureChannel.Handshake(tcp.GetStream(), Master(), true, ChannelType.File, _o.Id, ListenPort);
                ch.Send(offer.ToByteArray());
                return ch;
            }
            catch { tcp.Close(); throw; }
        }

        static void ConnectWithTimeout(TcpClient tcp, IPEndPoint ep, int ms)
        {
            var ar = tcp.BeginConnect(ep.Address, ep.Port, null, null);
            if (!ar.AsyncWaitHandle.WaitOne(ms)) { tcp.Close(); throw new TimeoutException("connect timeout"); }
            tcp.EndConnect(ar);
        }

        void ConnectLoop()
        {
            while (!_stop)
            {
                try
                {
                    if (!IsConnected) TryConnectOnce();
                }
                catch (Exception ex) { _o.Log("connect loop: " + ex.Message); }
                Thread.Sleep(500);
            }
        }

        void TryConnectOnce()
        {
            IPEndPoint target = null;
            string manual = (_o.ManualAddress() ?? "").Trim();
            if (manual.Length > 0)
            {
                var parts = manual.Split(':');
                if (IPAddress.TryParse(parts[0], out var ip))
                    target = new IPEndPoint(ip, parts.Length > 1 && int.TryParse(parts[1], out int p) ? p : 45655);
            }
            else if (_discovery != null)
            {
                var now = DateTime.UtcNow;
                var all = _discovery.Candidates();
                // Only the PC with the smaller id dials, so the two never cross-connect.
                // Wait a moment after first sight so every cable/network path has been seen.
                var c = all.FirstOrDefault(x => _o.Id.CompareTo(x.PeerId) < 0 &&
                    all.Where(y => y.PeerId == x.PeerId).Min(y => y.FirstSeen) < now.AddSeconds(-1.5));
                if (c != null) target = new IPEndPoint(c.Address, c.TcpPort);
            }
            if (target == null) return;

            var tcp = new TcpClient(AddressFamily.InterNetwork) { NoDelay = true };
            _connecting = true;
            try
            {
                ConnectWithTimeout(tcp, target, 2000);
                tcp.ReceiveTimeout = 8000; tcp.SendTimeout = 8000;
                var ch = SecureChannel.Handshake(tcp.GetStream(), Master(), true, ChannelType.Control, _o.Id, ListenPort);
                Install(new Session(this, tcp, ch, target));
            }
            catch (AuthException)
            {
                tcp.Close();
                StatusChanged?.Invoke(LinkStatus.CodeMismatch);
                Thread.Sleep(2500);
            }
            catch (Exception) { tcp.Close(); }
            finally { _connecting = false; }
        }

        void AcceptLoop()
        {
            while (!_stop)
            {
                TcpClient tcp;
                try { tcp = _listener.AcceptTcpClient(); }
                catch (Exception) { if (_stop) return; Thread.Sleep(200); continue; }
                new Thread(() => HandleIncoming(tcp)) { IsBackground = true, Name = "mb-incoming" }.Start();
            }
        }

        void HandleIncoming(TcpClient tcp)
        {
            try
            {
                tcp.NoDelay = true;
                tcp.ReceiveTimeout = 8000; tcp.SendTimeout = 8000;
                var ch = SecureChannel.Handshake(tcp.GetStream(), Master(), false, ChannelType.Control, _o.Id, ListenPort);
                var remote = (IPEndPoint)tcp.Client.RemoteEndPoint;
                if (ch.PeerType == ChannelType.File)
                {
                    tcp.ReceiveTimeout = 30000; tcp.SendTimeout = 30000;
                    var req = ch.Receive();
                    var paths = req.Length == 16 ? ResolveOffer(new Guid(req)) : null;
                    FileTransfer.Send(ch, paths ?? Array.Empty<string>());
                    tcp.Close();
                    return;
                }
                // The smaller id is the rightful dialer and always wins; a larger id (manual IP on
                // both PCs) is only accepted when nothing else is connected or being connected.
                bool peerIsDialer = ch.PeerId.CompareTo(_o.Id) < 0;
                if (!peerIsDialer && (IsConnected || _connecting)) { tcp.Close(); return; }
                Install(new Session(this, tcp, ch, new IPEndPoint(remote.Address, ch.PeerListenPort)));
            }
            catch (AuthException)
            {
                tcp.Close();
                if (!IsConnected) StatusChanged?.Invoke(LinkStatus.CodeMismatch);
            }
            catch (Exception ex) { _o.Log("incoming: " + ex.Message); tcp.Close(); }
        }

        void Install(Session s)
        {
            Session old;
            lock (_lock) { old = _current; _current = null; }
            if (old != null) { old.Close(); }
            lock (_lock) _current = s;
            StatusChanged?.Invoke(LinkStatus.Connected);
            Connected?.Invoke();
            s.Start();
        }

        void OnClosed(Session s)
        {
            bool wasCurrent;
            lock (_lock)
            {
                wasCurrent = _current == s;
                if (wasCurrent) _current = null;
            }
            if (wasCurrent && !_stop)
            {
                Disconnected?.Invoke();
                StatusChanged?.Invoke(LinkStatus.Searching);
            }
        }

        public void Dispose()
        {
            _stop = true;
            try { _listener?.Stop(); } catch (Exception) { }
            _discovery?.Dispose();
            Session s;
            lock (_lock) { s = _current; _current = null; }
            s?.Close();
        }

        sealed class Session
        {
            readonly LinkManager _m; readonly TcpClient _tcp;
            public readonly SecureChannel Channel;
            public readonly IPEndPoint PeerListener;
            readonly BlockingCollection<byte[]> _queue = new BlockingCollection<byte[]>();
            int _closed;
            static readonly byte[] Ping = new Msg(MsgType.Ping).Encode();

            public Session(LinkManager m, TcpClient tcp, SecureChannel ch, IPEndPoint peerListener)
            { _m = m; _tcp = tcp; Channel = ch; PeerListener = peerListener; }

            public void Start()
            {
                new Thread(WriteLoop) { IsBackground = true, Name = "mb-write" }.Start();
                new Thread(ReadLoop) { IsBackground = true, Name = "mb-read" }.Start();
            }

            public void Enqueue(byte[] frame)
            {
                if (_closed == 0) { try { _queue.Add(frame); } catch (Exception) { } }
            }

            void WriteLoop()
            {
                try
                {
                    while (_closed == 0)
                    {
                        // Idle links send a ping so a pulled cable is noticed within seconds.
                        if (_queue.TryTake(out var frame, 2000)) Channel.Send(frame);
                        else Channel.Send(Ping);
                    }
                }
                catch (Exception) { }
                Close();
            }

            void ReadLoop()
            {
                try
                {
                    while (_closed == 0)
                    {
                        var m = Msg.Decode(Channel.Receive());
                        if (m.Type == MsgType.Ping) continue;
                        try { _m.Received?.Invoke(m); }
                        catch (Exception ex) { _m._o.Log("handler: " + ex); }
                    }
                }
                catch (Exception) { }
                Close();
            }

            public void Close()
            {
                if (Interlocked.Exchange(ref _closed, 1) != 0) return;
                try { _tcp.Close(); } catch (Exception) { }
                _m.OnClosed(this);
            }
        }
    }
}
