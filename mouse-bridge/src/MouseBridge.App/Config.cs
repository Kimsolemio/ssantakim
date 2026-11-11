using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using MouseBridge.Core;

namespace MouseBridge.App
{
    static class Log
    {
        static readonly object Lock = new object();
        static readonly string Dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MouseBridge");
        public static string FilePath => Path.Combine(Dir, "log.txt");

        public static void Write(string message)
        {
            try
            {
                lock (Lock)
                {
                    Directory.CreateDirectory(Dir);
                    var fi = new FileInfo(FilePath);
                    if (fi.Exists && fi.Length > 2 * 1024 * 1024) fi.Delete();
                    File.AppendAllText(FilePath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + "  " + message + Environment.NewLine);
                }
            }
            catch (Exception) { }
        }
    }

    sealed class Config
    {
        public Guid Id = Guid.NewGuid();
        public string Code = NewCode();
        public Side PeerSide = Side.Right;
        public string ManualAddress = "";

        static string PathOf => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MouseBridge", "config.txt");

        public static string NewCode()
        {
            const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no look-alike characters
            var bytes = new byte[8];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
            var sb = new StringBuilder();
            for (int i = 0; i < 8; i++)
            {
                if (i == 4) sb.Append('-');
                sb.Append(alphabet[bytes[i] % alphabet.Length]);
            }
            return sb.ToString();
        }

        public static bool Exists => File.Exists(PathOf);

        public static Config Load()
        {
            var c = new Config();
            try
            {
                if (File.Exists(PathOf))
                {
                    var map = new Dictionary<string, string>();
                    foreach (var line in File.ReadAllLines(PathOf))
                    {
                        int i = line.IndexOf('=');
                        if (i > 0) map[line.Substring(0, i).Trim()] = line.Substring(i + 1).Trim();
                    }
                    if (map.TryGetValue("id", out var id) && Guid.TryParse(id, out var g)) c.Id = g;
                    if (map.TryGetValue("code", out var code) && code.Length > 0) c.Code = code;
                    if (map.TryGetValue("side", out var side)) c.PeerSide = side == "left" ? Side.Left : Side.Right;
                    if (map.TryGetValue("manual", out var manual)) c.ManualAddress = manual;
                }
            }
            catch (Exception ex) { Log.Write("config load: " + ex.Message); }
            c.Save();
            return c;
        }

        public void Save()
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(PathOf));
                File.WriteAllLines(PathOf, new[]
                {
                    "id=" + Id, "code=" + Code,
                    "side=" + (PeerSide == Side.Left ? "left" : "right"),
                    "manual=" + ManualAddress,
                });
            }
            catch (Exception ex) { Log.Write("config save: " + ex.Message); }
        }
    }
}
