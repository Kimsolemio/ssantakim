using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using MouseBridge.Core;
using Xunit;

public class ProtocolTests
{
    [Fact]
    public void Msg_roundtrips_all_fields()
    {
        var m = new Msg(MsgType.ClipFiles)
        {
            A = -5, B = 7, C = 1 << 30, Ratio = 0.375, Size = 1L << 40,
            Offer = Guid.NewGuid(), Text = "한글 텍스트 ✓", Data = new byte[] { 1, 2, 3 }
        };
        var d = Msg.Decode(m.Encode());
        Assert.Equal(m.Type, d.Type);
        Assert.Equal(m.A, d.A); Assert.Equal(m.B, d.B); Assert.Equal(m.C, d.C);
        Assert.Equal(m.Ratio, d.Ratio); Assert.Equal(m.Size, d.Size);
        Assert.Equal(m.Offer, d.Offer); Assert.Equal(m.Text, d.Text); Assert.Equal(m.Data, d.Data);
    }

    [Fact]
    public void Msg_rejects_truncated_input()
    {
        var bytes = new Msg(MsgType.ClipText) { Text = "hello" }.Encode();
        Assert.ThrowsAny<Exception>(() => Msg.Decode(bytes.Take(bytes.Length - 3).ToArray()));
    }

    [Fact]
    public void Edge_geometry()
    {
        var v = new ScreenRect(0, 0, 1920, 1080);
        Assert.True(EdgeMath.AtEdge(v, Side.Right, 1919));
        Assert.False(EdgeMath.AtEdge(v, Side.Right, 1900));
        Assert.True(EdgeMath.AtEdge(v, Side.Left, 0));
        Assert.False(EdgeMath.AtEdge(v, Side.Left, 5));
        Assert.True(EdgeMath.Beyond(v, Side.Right, 1920));
        Assert.False(EdgeMath.Beyond(v, Side.Right, 1919));
        Assert.True(EdgeMath.Beyond(v, Side.Left, -1));
        Assert.Equal(0.5, EdgeMath.Ratio(v, 540), 2);
        Assert.Equal(1.0, EdgeMath.Ratio(v, 5000));

        // Leaving a 1080p screen at 25% height arrives at 25% of a 1440p screen, just inside its edge.
        var big = new ScreenRect(-2560, 0, 2560, 1440);
        EdgeMath.EntryPoint(big, Side.Right, 0.25, out int x, out int y);
        Assert.InRange(x, big.Right - 10, big.Right - 1);
        Assert.Equal(360, y);
        EdgeMath.EntryPoint(big, Side.Left, double.NaN, out x, out y);
        Assert.InRange(x, big.Left, big.Left + 10);
        Assert.False(EdgeMath.AtEdge(big, Side.Left, x)); // must not bounce straight back
    }

    [Fact]
    public void Beacon_roundtrip_and_ranking()
    {
        var id = Guid.NewGuid();
        Assert.True(Discovery.ParseBeacon(Discovery.BuildBeacon(id, 45655), out var got, out int port));
        Assert.Equal(id, got); Assert.Equal(45655, port);
        Assert.False(Discovery.ParseBeacon(new byte[22], out _, out _));
        Assert.False(Discovery.ParseBeacon(new byte[5], out _, out _));

        Assert.Equal(IPAddress.Parse("169.254.255.255"),
            Discovery.BroadcastOf(IPAddress.Parse("169.254.10.3"), IPAddress.Parse("255.255.0.0")));
        Assert.True(Discovery.SameSubnet(IPAddress.Parse("192.168.0.5"), IPAddress.Parse("192.168.0.77"), IPAddress.Parse("255.255.255.0")));
        Assert.False(Discovery.SameSubnet(IPAddress.Parse("192.168.0.5"), IPAddress.Parse("192.168.1.77"), IPAddress.Parse("255.255.255.0")));

        // A USB 3.0 link (5 Gbps) beats gigabit LAN, and any wire beats faster Wi-Fi.
        var ranked = Discovery.Rank(new[]
        {
            new Discovery.Candidate { Address = IPAddress.Parse("10.0.0.1"), Speed = 2_400_000_000, Wireless = true },
            new Discovery.Candidate { Address = IPAddress.Parse("10.0.0.2"), Speed = 1_000_000_000 },
            new Discovery.Candidate { Address = IPAddress.Parse("10.0.0.3"), Speed = 5_000_000_000 },
        });
        Assert.Equal(new[] { "10.0.0.3", "10.0.0.2", "10.0.0.1" }, ranked.Select(c => c.Address.ToString()));
    }
}

public class ChannelTests
{
    internal static (SecureChannel a, SecureChannel b) Pair(string codeA, string codeB, out Exception errA, out Exception errB)
    {
        var l = new TcpListener(IPAddress.Loopback, 0); l.Start();
        var ca = new TcpClient(); ca.Connect(IPAddress.Loopback, ((IPEndPoint)l.LocalEndpoint).Port);
        var cb = l.AcceptTcpClient(); l.Stop();
        ca.ReceiveTimeout = cb.ReceiveTimeout = 10000;
        SecureChannel a = null, b = null; Exception ea = null, eb = null;
        var ta = Task.Run(() => { try { a = SecureChannel.Handshake(ca.GetStream(), SecureChannel.DeriveMaster(codeA), true, ChannelType.Control, Guid.NewGuid(), 1234); } catch (Exception e) { ea = e; ca.Close(); } });
        var tb = Task.Run(() => { try { b = SecureChannel.Handshake(cb.GetStream(), SecureChannel.DeriveMaster(codeB), false, ChannelType.Control, Guid.NewGuid(), 5678); } catch (Exception e) { eb = e; cb.Close(); } });
        Task.WaitAll(ta, tb);
        errA = ea; errB = eb;
        return (a, b);
    }

    [Fact]
    public void Same_code_connects_and_exchanges_messages()
    {
        var (a, b) = Pair("ABCD-EFGH", "abcdefgh ", out var ea, out var eb); // formatting differences are ignored
        Assert.Null(ea); Assert.Null(eb);
        Assert.Equal(ChannelType.Control, b.PeerType);
        Assert.Equal(1234, b.PeerListenPort);
        Assert.Equal(5678, a.PeerListenPort);
        var big = new byte[3_000_000]; new Random(1).NextBytes(big);
        // Send from another thread: a 3 MB write only completes while the other side is reading.
        var sending = Task.Run(() => { a.Send(big); a.Send(new byte[0]); });
        b.Send(new byte[] { 9 });
        Assert.Equal(big, b.Receive());
        Assert.Empty(b.Receive());
        Assert.Equal(new byte[] { 9 }, a.Receive());
        sending.Wait();
    }

    [Fact]
    public void Different_code_is_rejected()
    {
        Pair("ABCDEFGH", "ABCDEFGX", out var ea, out var eb);
        Assert.True(ea is AuthException || eb is AuthException, $"expected AuthException, got {ea} / {eb}");
        Assert.NotNull(ea); Assert.NotNull(eb);
    }

    sealed class Tamper : Stream
    {
        readonly Stream _s; public int FlipAt = -1; int _n;
        public Tamper(Stream s) { _s = s; }
        public override int Read(byte[] b, int o, int c)
        {
            int r = _s.Read(b, o, c);
            for (int i = 0; i < r; i++, _n++) if (_n == FlipAt) b[o + i] ^= 0x40;
            return r;
        }
        public override void Write(byte[] b, int o, int c) => _s.Write(b, o, c);
        public override void Flush() => _s.Flush();
        public override bool CanRead => true; public override bool CanSeek => false; public override bool CanWrite => true;
        public override long Length => 0; public override long Position { get => 0; set { } }
        public override long Seek(long o, SeekOrigin s) => 0; public override void SetLength(long v) { }
    }

    [Fact]
    public void Tampered_frame_is_rejected()
    {
        var l = new TcpListener(IPAddress.Loopback, 0); l.Start();
        var ca = new TcpClient(); ca.Connect(IPAddress.Loopback, ((IPEndPoint)l.LocalEndpoint).Port);
        var cb = l.AcceptTcpClient(); l.Stop();
        var master = SecureChannel.DeriveMaster("CODE1234");
        var tamper = new Tamper(cb.GetStream());
        SecureChannel a = null, b = null;
        Task.WaitAll(
            Task.Run(() => a = SecureChannel.Handshake(ca.GetStream(), master, true, ChannelType.Control, Guid.NewGuid(), 1)),
            Task.Run(() => b = SecureChannel.Handshake(tamper, master, false, ChannelType.Control, Guid.NewGuid(), 2)));
        a.Send(new byte[100]);
        b.Receive();
        tamper.FlipAt = 0; // counter restarts below
        var t2 = new Tamper(cb.GetStream()) { FlipAt = 30 }; // a ciphertext byte of the next frame
        var f = typeof(SecureChannel).GetField("_s", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
        f.SetValue(b, t2);
        a.Send(new byte[100]);
        Assert.Throws<AuthException>(() => b.Receive());
    }
}

public class FileTransferTests
{
    static string Temp() { var d = Path.Combine(Path.GetTempPath(), "mbtest-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(d); return d; }
    static string Hash(string f) { using var s = SHA256.Create(); return Convert.ToHexString(s.ComputeHash(File.ReadAllBytes(f))); }

    [Theory]
    [InlineData("../evil.txt")]
    [InlineData("a/../../evil.txt")]
    [InlineData("/etc/passwd")]
    [InlineData("a//b")]
    [InlineData("..")]
    [InlineData("")]
    public void Unsafe_paths_are_rejected(string rel)
    {
        var root = Temp();
        Assert.Throws<InvalidDataException>(() => FileTransfer.SafeCombine(root, rel, out _));
    }

    [Fact]
    public void Safe_paths_stay_inside_destination()
    {
        var root = Temp();
        var p = FileTransfer.SafeCombine(root, "폴더/sub\\파일?.txt", out var first);
        Assert.Equal("폴더", first);
        Assert.StartsWith(root + Path.DirectorySeparatorChar, p);
        Assert.EndsWith("파일_.txt", p);
        Assert.EndsWith("_CON.txt", FileTransfer.SafeCombine(root, "CON.txt", out _));
        Assert.EndsWith("C_", FileTransfer.SafeCombine(root, "C:", out _));
    }

    [Fact]
    public void Folder_tree_arrives_intact()
    {
        var src = Temp(); var dst = Temp();
        var rnd = new Random(7);
        var tree = Path.Combine(src, "프로젝트");
        Directory.CreateDirectory(Path.Combine(tree, "sub", "deep"));
        Directory.CreateDirectory(Path.Combine(tree, "빈폴더"));
        var files = new Dictionary<string, int>
        {
            ["프로젝트/a.bin"] = 0, ["프로젝트/sub/b.bin"] = 1, ["프로젝트/sub/deep/c.bin"] = 2_500_000,
            ["프로젝트/sub/한글 이름.txt"] = 70_000, ["single.dat"] = 1_048_576,
        };
        foreach (var kv in files)
        {
            var data = new byte[kv.Value]; rnd.NextBytes(data);
            File.WriteAllBytes(Path.Combine(src, kv.Key.Replace('/', Path.DirectorySeparatorChar)), data);
        }
        var roots = new[] { tree, Path.Combine(src, "single.dat"), Path.Combine(src, "missing.txt") };
        FileTransfer.Measure(roots, out long total, out int count);
        Assert.Equal(files.Values.Sum(v => (long)v), total);
        Assert.Equal(5, count);

        var (a, b) = ChannelTests.Pair("X", "X", out _, out _);
        long lastDone = -1, lastTotal = -1;
        var send = Task.Run(() => FileTransfer.Send(a, roots));
        var top = FileTransfer.Receive(b, dst, (d, t) => { lastDone = d; lastTotal = t; });
        send.Wait();

        Assert.Equal(new[] { "single.dat", "프로젝트" }, top.Select(Path.GetFileName).OrderBy(x => x, StringComparer.Ordinal));
        Assert.Equal(total, lastDone); Assert.Equal(total, lastTotal);
        Assert.True(Directory.Exists(Path.Combine(dst, "프로젝트", "빈폴더")));
        foreach (var kv in files)
        {
            var rel = kv.Key.Replace('/', Path.DirectorySeparatorChar);
            Assert.Equal(Hash(Path.Combine(src, rel)), Hash(Path.Combine(dst, rel)));
            Assert.Equal(File.GetLastWriteTimeUtc(Path.Combine(src, rel)), File.GetLastWriteTimeUtc(Path.Combine(dst, rel)));
        }
    }

    [Fact]
    public void Offer_registry_forgets_old_offers()
    {
        var r = new OfferRegistry();
        var first = r.Add(new[] { "a" });
        Assert.Equal(new[] { "a" }, r.Resolve(first));
        for (int i = 0; i < 10; i++) r.Add(new[] { "x" + i });
        Assert.Null(r.Resolve(first));
        Assert.Null(r.Resolve(Guid.NewGuid()));
    }
}

public class LinkManagerTests
{
    static bool WaitFor(Func<bool> cond, int ms = 8000)
    {
        var end = DateTime.UtcNow.AddMilliseconds(ms);
        while (DateTime.UtcNow < end) { if (cond()) return true; Thread.Sleep(20); }
        return cond();
    }

    static LinkManager Make(string code, Func<string> manual, List<Msg> inbox, List<LinkStatus> status = null)
    {
        var m = new LinkManager(new LinkOptions { Code = () => code, ManualAddress = manual, TcpPort = 0, EnableDiscovery = false });
        m.Received += x => { lock (inbox) inbox.Add(x); };
        if (status != null) m.StatusChanged += s => { lock (status) status.Add(s); };
        m.Start();
        return m;
    }

    [Fact]
    public void Two_peers_connect_talk_transfer_files_and_recover()
    {
        var inA = new List<Msg>(); var inB = new List<Msg>();
        using var b = Make("PAIRCODE", () => "", inB);
        // Both sides dial each other (manual IP on both PCs) - they must still end with one link.
        string toA = "";
        using var a = Make("PAIRCODE", () => "127.0.0.1:" + b.ListenPort, inA);
        toA = "127.0.0.1:" + a.ListenPort;

        Assert.True(WaitFor(() => a.IsConnected && b.IsConnected));
        Assert.Equal(b.Id, a.PeerId); Assert.Equal(a.Id, b.PeerId);

        a.Send(new Msg(MsgType.ClipText) { Text = "복사한 글자" });
        for (int i = 0; i < 200; i++) b.Send(new Msg(MsgType.MouseMove) { A = i, B = -i });
        Assert.True(WaitFor(() => { lock (inB) return inB.Count == 1; }));
        Assert.True(WaitFor(() => { lock (inA) return inA.Count == 200; }));
        Assert.Equal("복사한 글자", inB[0].Text);
        Assert.Equal(Enumerable.Range(0, 200), inA.Select(m => m.A)); // order preserved

        // File offer from B, fetched by A over a separate connection while control stays up.
        var src = Path.Combine(Path.GetTempPath(), "mbtest-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(src);
        var data = new byte[5_000_000]; new Random(3).NextBytes(data);
        File.WriteAllBytes(Path.Combine(src, "big.bin"), data);
        var offers = new OfferRegistry();
        b.ResolveOffer = offers.Resolve;
        var id = offers.Add(new[] { Path.Combine(src, "big.bin") });
        var dst = src + "-out";
        using (var ch = a.OpenFileChannel(id))
        {
            var top = FileTransfer.Receive(ch, dst);
            Assert.Single(top);
            Assert.Equal(data, File.ReadAllBytes(top[0]));
        }
        // Unknown offer yields an empty, well-formed transfer rather than an error or a hang.
        using (var ch = a.OpenFileChannel(Guid.NewGuid()))
            Assert.Empty(FileTransfer.Receive(ch, dst + "2"));
        Assert.True(a.IsConnected);

        // Cable pulled: both sides notice, then reconnect on their own.
        int disc = 0; b.Disconnected += () => Interlocked.Increment(ref disc);
        a.Reconnect();
        Assert.True(WaitFor(() => disc >= 1));
        Assert.True(WaitFor(() => a.IsConnected && b.IsConnected));
        b.Send(new Msg(MsgType.ReleaseAll));
        Assert.True(WaitFor(() => { lock (inA) return inA.Any(m => m.Type == MsgType.ReleaseAll); }));
    }

    [Fact]
    public void Both_sides_dialing_end_up_with_a_single_working_link()
    {
        var inA = new List<Msg>(); var inB = new List<Msg>();
        string addrA = "", addrB = "";
        using var a = Make("SAME", () => addrB, inA);
        using var b = Make("SAME", () => addrA, inB);
        addrA = "127.0.0.1:" + a.ListenPort; addrB = "127.0.0.1:" + b.ListenPort;
        Assert.True(WaitFor(() => a.IsConnected && b.IsConnected));
        Thread.Sleep(1500); // let any duplicate connection settle
        Assert.True(WaitFor(() => a.IsConnected && b.IsConnected));
        a.Send(new Msg(MsgType.Layout) { A = 1 });
        b.Send(new Msg(MsgType.Layout) { A = 0 });
        Assert.True(WaitFor(() => { lock (inA) lock (inB) return inA.Count >= 1 && inB.Count >= 1; }));
    }

    [Fact]
    public void Wrong_code_never_connects_and_reports_mismatch()
    {
        var status = new List<LinkStatus>();
        using var b = Make("CODE-ONE", () => "", new List<Msg>());
        using var a = Make("CODE-TWO", () => "127.0.0.1:" + b.ListenPort, new List<Msg>(), status);
        Assert.True(WaitFor(() => { lock (status) return status.Contains(LinkStatus.CodeMismatch); }));
        Assert.False(a.IsConnected); Assert.False(b.IsConnected);
    }
}
