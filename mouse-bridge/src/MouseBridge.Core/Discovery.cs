using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Threading;

namespace MouseBridge.Core
{
    /// <summary>
    /// Finds the other PC by UDP broadcast on every network interface (USB link cable,
    /// USB Ethernet adapter, Thunderbolt, LAN, Wi-Fi) and ranks the paths by link speed.
    /// </summary>
    public sealed class Discovery : IDisposable
    {
        public sealed class Candidate
        {
            public Guid PeerId; public IPAddress Address; public int TcpPort;
            public long Speed; public bool Wireless; public DateTime FirstSeen, LastSeen;
        }

        static readonly byte[] Magic = { (byte)'M', (byte)'B', (byte)'D', (byte)'1' };
        readonly Guid _id; readonly int _udpPort, _tcpPort;
        readonly Dictionary<string, Candidate> _seen = new Dictionary<string, Candidate>();
        readonly object _lock = new object();
        UdpClient _recv;
        volatile bool _stop;

        public Discovery(Guid id, int udpPort, int tcpPort) { _id = id; _udpPort = udpPort; _tcpPort = tcpPort; }

        public void Start()
        {
            _recv = new UdpClient(AddressFamily.InterNetwork);
            _recv.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            _recv.Client.Bind(new IPEndPoint(IPAddress.Any, _udpPort));
            new Thread(ReceiveLoop) { IsBackground = true, Name = "mb-discovery-rx" }.Start();
            new Thread(BeaconLoop) { IsBackground = true, Name = "mb-discovery-tx" }.Start();
        }

        public static byte[] BuildBeacon(Guid id, int tcpPort)
        {
            var b = new byte[4 + 16 + 2];
            Buffer.BlockCopy(Magic, 0, b, 0, 4);
            Buffer.BlockCopy(id.ToByteArray(), 0, b, 4, 16);
            b[20] = (byte)(tcpPort >> 8); b[21] = (byte)tcpPort;
            return b;
        }

        public static bool ParseBeacon(byte[] b, out Guid id, out int tcpPort)
        {
            id = Guid.Empty; tcpPort = 0;
            if (b == null || b.Length != 22) return false;
            for (int i = 0; i < 4; i++) if (b[i] != Magic[i]) return false;
            var g = new byte[16]; Buffer.BlockCopy(b, 4, g, 0, 16);
            id = new Guid(g); tcpPort = (b[20] << 8) | b[21];
            return tcpPort > 0;
        }

        public static IPAddress BroadcastOf(IPAddress addr, IPAddress mask)
        {
            var a = addr.GetAddressBytes(); var m = mask.GetAddressBytes();
            var r = new byte[4];
            for (int i = 0; i < 4; i++) r[i] = (byte)(a[i] | ~m[i]);
            return new IPAddress(r);
        }

        public static bool SameSubnet(IPAddress a, IPAddress b, IPAddress mask)
        {
            var x = a.GetAddressBytes(); var y = b.GetAddressBytes(); var m = mask.GetAddressBytes();
            for (int i = 0; i < 4; i++) if ((x[i] & m[i]) != (y[i] & m[i])) return false;
            return true;
        }

        sealed class Nic { public IPAddress Addr, Mask; public long Speed; public bool Wireless; }

        static List<Nic> LocalNics()
        {
            var list = new List<Nic>();
            try
            {
                foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up) continue;
                    if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                    long speed = 0;
                    try { speed = ni.Speed; } catch (Exception) { }
                    foreach (var ua in ni.GetIPProperties().UnicastAddresses)
                    {
                        if (ua.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                        IPAddress mask = null;
                        try { mask = ua.IPv4Mask; } catch (Exception) { }
                        if (mask == null || mask.Equals(IPAddress.Any)) mask = IPAddress.Parse("255.255.0.0");
                        list.Add(new Nic
                        {
                            Addr = ua.Address, Mask = mask, Speed = speed,
                            Wireless = ni.NetworkInterfaceType == NetworkInterfaceType.Wireless80211
                        });
                    }
                }
            }
            catch (Exception) { }
            return list;
        }

        void BeaconLoop()
        {
            var beacon = BuildBeacon(_id, _tcpPort);
            while (!_stop)
            {
                foreach (var nic in LocalNics())
                {
                    try
                    {
                        using (var u = new UdpClient(new IPEndPoint(nic.Addr, 0)))
                        {
                            u.EnableBroadcast = true;
                            u.Send(beacon, beacon.Length, new IPEndPoint(BroadcastOf(nic.Addr, nic.Mask), _udpPort));
                            u.Send(beacon, beacon.Length, new IPEndPoint(IPAddress.Broadcast, _udpPort));
                        }
                    }
                    catch (Exception) { }
                }
                Thread.Sleep(1000);
            }
        }

        void ReceiveLoop()
        {
            while (!_stop)
            {
                try
                {
                    var from = new IPEndPoint(IPAddress.Any, 0);
                    var data = _recv.Receive(ref from);
                    if (!ParseBeacon(data, out var id, out int port) || id == _id) continue;
                    var nic = LocalNics().FirstOrDefault(n => SameSubnet(n.Addr, from.Address, n.Mask));
                    var now = DateTime.UtcNow;
                    lock (_lock)
                    {
                        string key = id + "|" + from.Address;
                        if (!_seen.TryGetValue(key, out var c))
                            _seen[key] = c = new Candidate { PeerId = id, Address = from.Address, FirstSeen = now };
                        c.TcpPort = port; c.LastSeen = now;
                        c.Speed = nic?.Speed ?? 0; c.Wireless = nic?.Wireless ?? false;
                    }
                }
                catch (Exception) { if (_stop) return; Thread.Sleep(200); }
            }
        }

        /// <summary>Live paths to peers, fastest wired link first.</summary>
        public List<Candidate> Candidates()
        {
            var now = DateTime.UtcNow;
            lock (_lock)
            {
                foreach (var k in _seen.Where(kv => (now - kv.Value.LastSeen).TotalSeconds > 4).Select(kv => kv.Key).ToList())
                    _seen.Remove(k);
                return Rank(_seen.Values);
            }
        }

        public static List<Candidate> Rank(IEnumerable<Candidate> list)
            => list.OrderBy(c => c.Wireless ? 1 : 0).ThenByDescending(c => c.Speed).ToList();

        public void Dispose()
        {
            _stop = true;
            try { _recv?.Close(); } catch (Exception) { }
        }
    }
}
