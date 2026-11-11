using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace MouseBridge.Core
{
    public sealed class AuthException : Exception
    {
        public AuthException(string message) : base(message) { }
    }

    public enum ChannelType : byte { Control = 0, File = 1, Acceptor = 0xFF }

    /// <summary>
    /// Encrypted, authenticated message framing over a stream. Both PCs share a pairing code;
    /// keys are derived from it plus fresh nonces. Each frame is AES-256-CBC + HMAC-SHA256
    /// with a sequence number, so a wrong code, tampering and replays are all rejected.
    /// </summary>
    public sealed class SecureChannel : IDisposable
    {
        public const int MaxPayload = 64 * 1024 * 1024;
        static readonly byte[] Magic = { (byte)'M', (byte)'B', (byte)'R', (byte)'1' };
        static readonly byte[] Confirm = Encoding.ASCII.GetBytes("MB-OK");
        const int HelloSize = 4 + 1 + 16 + 2 + 16;

        readonly Stream _s;
        readonly Aes _aesOut, _aesIn;
        readonly HMACSHA256 _macOut, _macIn;
        readonly object _sendLock = new object();
        readonly RandomNumberGenerator _rng = RandomNumberGenerator.Create();
        ulong _seqOut, _seqIn;

        public Guid PeerId { get; private set; }
        public ChannelType PeerType { get; private set; }
        public int PeerListenPort { get; private set; }

        SecureChannel(Stream s, byte[] encOut, byte[] macOut, byte[] encIn, byte[] macIn)
        {
            _s = s;
            _aesOut = Aes.Create(); _aesOut.Key = encOut;
            _aesIn = Aes.Create(); _aesIn.Key = encIn;
            _macOut = new HMACSHA256(macOut);
            _macIn = new HMACSHA256(macIn);
        }

        public static byte[] DeriveMaster(string code)
        {
            string norm = (code ?? "").Trim().Replace("-", "").Replace(" ", "").ToUpperInvariant();
            using (var kdf = new Rfc2898DeriveBytes(norm, Encoding.ASCII.GetBytes("MouseBridge.v1.salt"), 50000))
                return kdf.GetBytes(32);
        }

        /// <summary>Runs the handshake. Throws <see cref="AuthException"/> when the pairing codes differ.</summary>
        public static SecureChannel Handshake(Stream s, byte[] master, bool initiator, ChannelType type, Guid myId, int myListenPort)
        {
            var myNonce = new byte[16];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(myNonce);

            var hello = new byte[HelloSize];
            Buffer.BlockCopy(Magic, 0, hello, 0, 4);
            hello[4] = (byte)(initiator ? type : ChannelType.Acceptor);
            Buffer.BlockCopy(myId.ToByteArray(), 0, hello, 5, 16);
            hello[21] = (byte)(myListenPort >> 8); hello[22] = (byte)myListenPort;
            Buffer.BlockCopy(myNonce, 0, hello, 23, 16);
            s.Write(hello, 0, hello.Length);
            s.Flush();

            var peer = ReadExact(s, HelloSize);
            for (int i = 0; i < 4; i++)
                if (peer[i] != Magic[i]) throw new InvalidDataException("not a MouseBridge peer");
            var idBytes = new byte[16]; Buffer.BlockCopy(peer, 5, idBytes, 0, 16);
            var peerNonce = new byte[16]; Buffer.BlockCopy(peer, 23, peerNonce, 0, 16);
            var peerId = new Guid(idBytes);
            if (peerId == myId) throw new InvalidDataException("connected to self");

            var ni = initiator ? myNonce : peerNonce;
            var na = initiator ? peerNonce : myNonce;
            byte[] K(string label)
            {
                using (var h = new HMACSHA256(master))
                {
                    var l = Encoding.ASCII.GetBytes(label);
                    var buf = new byte[l.Length + 32];
                    Buffer.BlockCopy(l, 0, buf, 0, l.Length);
                    Buffer.BlockCopy(ni, 0, buf, l.Length, 16);
                    Buffer.BlockCopy(na, 0, buf, l.Length + 16, 16);
                    return h.ComputeHash(buf);
                }
            }
            string mine = initiator ? "i2a" : "a2i", theirs = initiator ? "a2i" : "i2a";
            var ch = new SecureChannel(s, K(mine + "-enc"), K(mine + "-mac"), K(theirs + "-enc"), K(theirs + "-mac"))
            {
                PeerId = peerId,
                PeerType = (ChannelType)peer[4],
                PeerListenPort = (peer[21] << 8) | peer[22],
            };
            ch.Send(Confirm);
            var c = ch.Receive();
            if (c.Length != Confirm.Length) throw new AuthException("pairing code mismatch");
            for (int i = 0; i < c.Length; i++)
                if (c[i] != Confirm[i]) throw new AuthException("pairing code mismatch");
            return ch;
        }

        public void Send(byte[] payload) => Send(payload, 0, payload.Length);

        public void Send(byte[] payload, int offset, int count)
        {
            if (count > MaxPayload) throw new ArgumentException("payload too large");
            lock (_sendLock)
            {
                var iv = new byte[16];
                _rng.GetBytes(iv);
                byte[] ct;
                using (var enc = _aesOut.CreateEncryptor(_aesOut.Key, iv))
                    ct = enc.TransformFinalBlock(payload, offset, count);
                var mac = ComputeMac(_macOut, _seqOut++, iv, ct);
                int len = 16 + ct.Length + 32;
                var frame = new byte[4 + len];
                frame[0] = (byte)(len >> 24); frame[1] = (byte)(len >> 16); frame[2] = (byte)(len >> 8); frame[3] = (byte)len;
                Buffer.BlockCopy(iv, 0, frame, 4, 16);
                Buffer.BlockCopy(ct, 0, frame, 20, ct.Length);
                Buffer.BlockCopy(mac, 0, frame, 20 + ct.Length, 32);
                _s.Write(frame, 0, frame.Length);
                _s.Flush();
            }
        }

        /// <summary>Reads one message. Must only be called from one thread at a time.</summary>
        public byte[] Receive()
        {
            var hdr = ReadExact(_s, 4);
            int len = (hdr[0] << 24) | (hdr[1] << 16) | (hdr[2] << 8) | hdr[3];
            if (len < 16 + 16 + 32 || len > MaxPayload + 96 || (len - 48) % 16 != 0)
                throw new InvalidDataException("bad frame length");
            var body = ReadExact(_s, len);
            var iv = new byte[16];
            Buffer.BlockCopy(body, 0, iv, 0, 16);
            var ct = new byte[len - 48];
            Buffer.BlockCopy(body, 16, ct, 0, ct.Length);
            var mac = ComputeMac(_macIn, _seqIn++, iv, ct);
            int diff = 0;
            for (int i = 0; i < 32; i++) diff |= mac[i] ^ body[16 + ct.Length + i];
            if (diff != 0) throw new AuthException("pairing code mismatch or corrupted data");
            using (var dec = _aesIn.CreateDecryptor(_aesIn.Key, iv))
                return dec.TransformFinalBlock(ct, 0, ct.Length);
        }

        static byte[] ComputeMac(HMACSHA256 h, ulong seq, byte[] iv, byte[] ct)
        {
            var seqBytes = new byte[8];
            for (int i = 0; i < 8; i++) seqBytes[i] = (byte)(seq >> (56 - 8 * i));
            h.Initialize();
            h.TransformBlock(seqBytes, 0, 8, null, 0);
            h.TransformBlock(iv, 0, 16, null, 0);
            h.TransformFinalBlock(ct, 0, ct.Length);
            return h.Hash;
        }

        static byte[] ReadExact(Stream s, int n)
        {
            var buf = new byte[n];
            int got = 0;
            while (got < n)
            {
                int r = s.Read(buf, got, n - got);
                if (r <= 0) throw new EndOfStreamException();
                got += r;
            }
            return buf;
        }

        public void Dispose()
        {
            try { _s.Dispose(); } catch { }
            _aesOut.Dispose(); _aesIn.Dispose(); _macOut.Dispose(); _macIn.Dispose(); _rng.Dispose();
        }
    }
}
