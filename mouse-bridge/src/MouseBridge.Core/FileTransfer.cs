using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace MouseBridge.Core
{
    /// <summary>Remembers which local files were offered to the other PC (by copy or by drag).</summary>
    public sealed class OfferRegistry
    {
        readonly object _lock = new object();
        readonly Dictionary<Guid, string[]> _offers = new Dictionary<Guid, string[]>();
        readonly Queue<Guid> _order = new Queue<Guid>();
        const int Capacity = 8;

        public Guid Add(string[] paths)
        {
            var id = Guid.NewGuid();
            lock (_lock)
            {
                _offers[id] = paths;
                _order.Enqueue(id);
                while (_order.Count > Capacity) _offers.Remove(_order.Dequeue());
            }
            return id;
        }

        public string[] Resolve(Guid id)
        {
            lock (_lock) return _offers.TryGetValue(id, out var p) ? p : null;
        }
    }

    public static class FileTransfer
    {
        const byte KBegin = 0, KEntry = 1, KData = 2, KEnd = 3, KAck = 4;
        const int Chunk = 1024 * 1024;

        sealed class Entry { public string Full, Rel; public bool IsDir; public long Size; public DateTime Mtime; }

        /// <summary>Total size and file count of what an offer would send.</summary>
        public static void Measure(string[] roots, out long totalBytes, out int fileCount)
        {
            totalBytes = 0; fileCount = 0;
            foreach (var e in Enumerate(roots))
                if (!e.IsDir) { totalBytes += e.Size; fileCount++; }
        }

        static List<Entry> Enumerate(string[] roots)
        {
            var list = new List<Entry>();
            var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var root in roots ?? Array.Empty<string>())
            {
                try
                {
                    string trimmed = root.TrimEnd('\\', '/');
                    string name = Path.GetFileName(trimmed);
                    if (string.IsNullOrEmpty(name)) name = "drive";
                    string unique = name;
                    for (int i = 2; !used.Add(unique); i++) unique = name + " (" + i + ")";
                    if (Directory.Exists(root)) Walk(new DirectoryInfo(root), unique, list);
                    else if (File.Exists(root))
                    {
                        var fi = new FileInfo(root);
                        list.Add(new Entry { Full = fi.FullName, Rel = unique, Size = fi.Length, Mtime = fi.LastWriteTimeUtc });
                    }
                }
                catch (Exception) { /* unreadable root: skip */ }
            }
            return list;
        }

        static void Walk(DirectoryInfo dir, string rel, List<Entry> list)
        {
            list.Add(new Entry { Full = dir.FullName, Rel = rel, IsDir = true });
            FileSystemInfo[] items;
            try { items = dir.GetFileSystemInfos(); } catch (Exception) { return; }
            foreach (var it in items)
            {
                if ((it.Attributes & FileAttributes.ReparsePoint) != 0) continue; // avoid link loops
                string childRel = rel + "/" + it.Name;
                if (it is DirectoryInfo d) Walk(d, childRel, list);
                else if (it is FileInfo f)
                    list.Add(new Entry { Full = f.FullName, Rel = childRel, Size = f.Length, Mtime = f.LastWriteTimeUtc });
            }
        }

        public static void Send(SecureChannel ch, string[] roots)
        {
            var entries = Enumerate(roots);
            long total = 0; int count = 0;
            foreach (var e in entries) if (!e.IsDir) { total += e.Size; count++; }

            ch.Send(Pack(w => { w.Write(KBegin); w.Write(total); w.Write(count); }));
            var buf = new byte[Chunk + 1];
            buf[0] = KData;
            foreach (var e in entries)
            {
                if (e.IsDir)
                {
                    ch.Send(Pack(w => { w.Write(KEntry); w.Write(e.Rel); w.Write(true); w.Write(0L); w.Write(0L); }));
                    continue;
                }
                FileStream fs;
                try { fs = new FileStream(e.Full, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 16, FileOptions.SequentialScan); }
                catch (Exception) { continue; } // locked or vanished: skip this file
                using (fs)
                {
                    ch.Send(Pack(w => { w.Write(KEntry); w.Write(e.Rel); w.Write(false); w.Write(e.Size); w.Write(e.Mtime.Ticks); }));
                    long left = e.Size;
                    while (left > 0)
                    {
                        int n = fs.Read(buf, 1, (int)Math.Min(Chunk, left));
                        if (n <= 0) throw new IOException("file changed while sending: " + e.Full);
                        ch.Send(buf, 0, n + 1);
                        left -= n;
                    }
                }
            }
            ch.Send(new[] { KEnd });
            var ack = ch.Receive(); // wait until the receiver has everything before closing
            if (ack.Length != 1 || ack[0] != KAck) throw new IOException("transfer not acknowledged");
        }

        /// <summary>Receives into destDir and returns the top-level files/folders created.</summary>
        public static string[] Receive(SecureChannel ch, string destDir, Action<long, long> progress = null)
        {
            Directory.CreateDirectory(destDir);
            string destFull = Path.GetFullPath(destDir);
            var top = new List<string>();
            var topSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            long total = 0, done = 0;
            FileStream cur = null; long curLeft = 0; string curPath = null; long curMtime = 0;
            try
            {
                while (true)
                {
                    var f = ch.Receive();
                    if (f.Length == 0) throw new InvalidDataException("empty frame");
                    switch (f[0])
                    {
                        case KBegin:
                            using (var r = new BinaryReader(new MemoryStream(f, 1, f.Length - 1)))
                                total = r.ReadInt64();
                            progress?.Invoke(0, total);
                            break;
                        case KEntry:
                            if (cur != null) throw new InvalidDataException("previous file incomplete");
                            using (var r = new BinaryReader(new MemoryStream(f, 1, f.Length - 1), Encoding.UTF8))
                            {
                                string rel = r.ReadString(); bool isDir = r.ReadBoolean();
                                long size = r.ReadInt64(); curMtime = r.ReadInt64();
                                string path = SafeCombine(destFull, rel, out string first);
                                if (topSeen.Add(first)) top.Add(Path.Combine(destFull, first));
                                if (isDir) Directory.CreateDirectory(path);
                                else
                                {
                                    if (size < 0) throw new InvalidDataException("bad size");
                                    Directory.CreateDirectory(Path.GetDirectoryName(path));
                                    curPath = path; curLeft = size;
                                    cur = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16);
                                    if (size == 0) CloseCurrent(ref cur, curPath, curMtime);
                                }
                            }
                            break;
                        case KData:
                            int n = f.Length - 1;
                            if (cur == null || n > curLeft) throw new InvalidDataException("unexpected data");
                            cur.Write(f, 1, n);
                            curLeft -= n; done += n;
                            progress?.Invoke(done, total);
                            if (curLeft == 0) CloseCurrent(ref cur, curPath, curMtime);
                            break;
                        case KEnd:
                            if (cur != null) throw new InvalidDataException("last file incomplete");
                            ch.Send(new[] { KAck });
                            return top.ToArray();
                        default:
                            throw new InvalidDataException("unknown frame");
                    }
                }
            }
            finally { cur?.Dispose(); }
        }

        static void CloseCurrent(ref FileStream cur, string path, long mtimeTicks)
        {
            cur.Dispose(); cur = null;
            try
            {
                if (mtimeTicks > 0) File.SetLastWriteTimeUtc(path, new DateTime(mtimeTicks, DateTimeKind.Utc));
            }
            catch (Exception) { }
        }

        static readonly HashSet<string> Reserved = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "CON","PRN","AUX","NUL","COM1","COM2","COM3","COM4","COM5","COM6","COM7","COM8","COM9",
            "LPT1","LPT2","LPT3","LPT4","LPT5","LPT6","LPT7","LPT8","LPT9"
        };

        /// <summary>
        /// Turns a relative path received from the network into a path strictly inside root.
        /// Rejects traversal ("..", rooted paths) and neutralises characters Windows does not allow.
        /// </summary>
        public static string SafeCombine(string rootFull, string rel, out string firstSegment)
        {
            var parts = (rel ?? "").Split(new[] { '/', '\\' });
            var clean = new List<string>();
            foreach (var raw in parts)
            {
                if (raw.Length == 0) throw new InvalidDataException("empty path segment");
                if (raw == "." || raw == "..") throw new InvalidDataException("path traversal rejected");
                var sb = new StringBuilder(raw.Length);
                foreach (char c in raw)
                    sb.Append(c < 32 || "<>:\"|?*".IndexOf(c) >= 0 ? '_' : c);
                string seg = sb.ToString().TrimEnd(' ', '.');
                if (seg.Length == 0) seg = "_";
                string stem = seg.Split('.')[0];
                if (Reserved.Contains(stem)) seg = "_" + seg;
                clean.Add(seg);
            }
            if (clean.Count == 0) throw new InvalidDataException("empty path");
            firstSegment = clean[0];
            string combined = rootFull;
            foreach (var seg in clean) combined = Path.Combine(combined, seg);
            string full = Path.GetFullPath(combined);
            string prefix = rootFull.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("path escapes destination");
            return full;
        }

        static byte[] Pack(Action<BinaryWriter> write)
        {
            using (var ms = new MemoryStream())
            using (var w = new BinaryWriter(ms, Encoding.UTF8))
            {
                write(w); w.Flush();
                return ms.ToArray();
            }
        }
    }
}
