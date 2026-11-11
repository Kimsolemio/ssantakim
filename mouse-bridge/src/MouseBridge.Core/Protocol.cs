using System;
using System.IO;
using System.Text;

namespace MouseBridge.Core
{
    public enum Side { Left = 0, Right = 1 }

    public enum MsgType : byte
    {
        Ping = 0,
        Hello = 1,        // Text=PC name, A=peer side as seen by sender
        Layout = 2,       // A=peer side as seen by sender
        Enter = 3,        // sender starts controlling receiver. Ratio, Offer (drag), A=left held
        Leave = 4,        // controlled PC hands the cursor back. Ratio, Offer (drag)
        MouseMove = 5,    // A=dx, B=dy
        MouseButton = 6,  // A=button (0 L,1 R,2 M,3 X1,4 X2), B=1 down
        MouseWheel = 7,   // A=delta, B=1 horizontal
        Key = 8,          // A=scan code, B=flags (1 extended, 2 down), C=virtual key
        ReleaseAll = 9,   // controller forcibly returned to local
        ClipText = 10,    // Text
        ClipImage = 11,   // Data = PNG
        ClipFiles = 12,   // Offer, Size=total bytes, A=file count
    }

    /// <summary>One control message. All fields are always encoded, which keeps the codec trivial.</summary>
    public sealed class Msg
    {
        public MsgType Type;
        public int A, B, C;
        public double Ratio;
        public long Size;
        public Guid Offer;
        public string Text;
        public byte[] Data;

        public Msg() { }
        public Msg(MsgType type) { Type = type; }

        public byte[] Encode()
        {
            using (var ms = new MemoryStream(64))
            using (var w = new BinaryWriter(ms, Encoding.UTF8))
            {
                w.Write((byte)Type);
                w.Write(A); w.Write(B); w.Write(C);
                w.Write(Ratio);
                w.Write(Size);
                w.Write(Offer.ToByteArray());
                w.Write(Text ?? "");
                var d = Data ?? Array.Empty<byte>();
                w.Write(d.Length);
                w.Write(d);
                w.Flush();
                return ms.ToArray();
            }
        }

        public static Msg Decode(byte[] buf)
        {
            using (var ms = new MemoryStream(buf, false))
            using (var r = new BinaryReader(ms, Encoding.UTF8))
            {
                var m = new Msg();
                m.Type = (MsgType)r.ReadByte();
                m.A = r.ReadInt32(); m.B = r.ReadInt32(); m.C = r.ReadInt32();
                m.Ratio = r.ReadDouble();
                m.Size = r.ReadInt64();
                m.Offer = new Guid(r.ReadBytes(16));
                m.Text = r.ReadString();
                int n = r.ReadInt32();
                if (n < 0 || n > ms.Length - ms.Position) throw new InvalidDataException("bad data length");
                m.Data = r.ReadBytes(n);
                return m;
            }
        }
    }

    public struct ScreenRect
    {
        public int Left, Top, Width, Height;
        public ScreenRect(int l, int t, int w, int h) { Left = l; Top = t; Width = w; Height = h; }
        public int Right => Left + Width;
        public int Bottom => Top + Height;
    }

    /// <summary>Screen-edge geometry shared by both PCs.</summary>
    public static class EdgeMath
    {
        public static Side Opposite(Side s) => s == Side.Left ? Side.Right : Side.Left;

        /// <summary>True when x touches (or passes) the edge on the given side.</summary>
        public static bool AtEdge(ScreenRect v, Side side, int x)
            => side == Side.Right ? x >= v.Right - 1 : x <= v.Left;

        /// <summary>True when x is beyond the screen on the given side.</summary>
        public static bool Beyond(ScreenRect v, Side side, double x)
            => side == Side.Right ? x > v.Right - 1 : x < v.Left;

        public static double Ratio(ScreenRect v, int y)
        {
            if (v.Height <= 1) return 0.5;
            double r = (double)(y - v.Top) / (v.Height - 1);
            return r < 0 ? 0 : r > 1 ? 1 : r;
        }

        /// <summary>Where the cursor appears when it arrives from the PC on <paramref name="peerSide"/>.</summary>
        public static void EntryPoint(ScreenRect v, Side peerSide, double ratio, out int x, out int y, int inset = 3)
        {
            if (double.IsNaN(ratio)) ratio = 0.5;
            ratio = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
            x = peerSide == Side.Right ? v.Right - 1 - inset : v.Left + inset;
            y = v.Top + (int)Math.Round(ratio * (v.Height - 1));
        }

        public static double Clamp(double val, double min, double max) => val < min ? min : val > max ? max : val;
    }
}
