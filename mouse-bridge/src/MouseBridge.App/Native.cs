using System;
using System.Runtime.InteropServices;
using MouseBridge.Core;

namespace MouseBridge.App
{
    static class Native
    {
        public const int WH_KEYBOARD_LL = 13, WH_MOUSE_LL = 14;
        public const int WM_MOUSEMOVE = 0x200, WM_LBUTTONDOWN = 0x201, WM_LBUTTONUP = 0x202,
            WM_RBUTTONDOWN = 0x204, WM_RBUTTONUP = 0x205, WM_MBUTTONDOWN = 0x207, WM_MBUTTONUP = 0x208,
            WM_MOUSEWHEEL = 0x20A, WM_XBUTTONDOWN = 0x20B, WM_XBUTTONUP = 0x20C, WM_MOUSEHWHEEL = 0x20E;
        public const int WM_CLIPBOARDUPDATE = 0x031D, WM_RENDERFORMAT = 0x0305,
            WM_RENDERALLFORMATS = 0x0306, WM_DESTROYCLIPBOARD = 0x0307;
        public const uint LLMHF_INJECTED = 0x1, LLKHF_EXTENDED = 0x1, LLKHF_INJECTED = 0x10, LLKHF_UP = 0x80;
        public const uint CF_HDROP = 15;
        public const int VK_LBUTTON = 1, VK_RBUTTON = 2, VK_MBUTTON = 4, VK_HOME = 0x24;

        public const int WS_EX_TOPMOST = 0x8, WS_EX_TOOLWINDOW = 0x80, WS_EX_LAYERED = 0x80000, WS_EX_NOACTIVATE = 0x08000000;

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X, Y; }

        [StructLayout(LayoutKind.Sequential)]
        public struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData, flags, time; public UIntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Sequential)]
        public struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public UIntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Explicit)]
        public struct InputUnion
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT { public uint type; public InputUnion U; }

        public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
        [DllImport("user32.dll")]
        public static extern bool UnhookWindowsHookEx(IntPtr hhk);
        [DllImport("user32.dll")]
        public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        public static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")]
        public static extern bool GetCursorPos(out POINT pt);
        [DllImport("user32.dll")]
        public static extern int GetSystemMetrics(int index);
        [DllImport("user32.dll")]
        public static extern short GetAsyncKeyState(int vKey);
        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")]
        public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool AddClipboardFormatListener(IntPtr hwnd);
        [DllImport("user32.dll")]
        public static extern bool RemoveClipboardFormatListener(IntPtr hwnd);
        [DllImport("user32.dll")]
        public static extern uint GetClipboardSequenceNumber();
        [DllImport("user32.dll")]
        public static extern IntPtr GetClipboardOwner();
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool OpenClipboard(IntPtr hWndNewOwner);
        [DllImport("user32.dll")]
        public static extern bool CloseClipboard();
        [DllImport("user32.dll")]
        public static extern bool EmptyClipboard();
        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr SetClipboardData(uint uFormat, IntPtr hMem);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern uint RegisterClipboardFormat(string lpszFormat);
        [DllImport("kernel32.dll")]
        public static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);
        [DllImport("kernel32.dll")]
        public static extern IntPtr GlobalLock(IntPtr hMem);
        [DllImport("kernel32.dll")]
        public static extern bool GlobalUnlock(IntPtr hMem);
        [DllImport("kernel32.dll")]
        public static extern IntPtr GlobalFree(IntPtr hMem);

        public static ScreenRect VirtualScreen()
            => new ScreenRect(GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79));

        public static bool AnyMouseButtonDown()
            => (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0 || (GetAsyncKeyState(VK_RBUTTON) & 0x8000) != 0
               || (GetAsyncKeyState(VK_MBUTTON) & 0x8000) != 0;

        public static void EnableDpiAwareness()
        {
            // Physical pixels everywhere, so cursor coordinates match on scaled displays.
            try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch (Exception) { }
            try { SetProcessDPIAware(); } catch (Exception) { }
        }
    }

    /// <summary>
    /// Replays mouse and keyboard input received from the other PC. Windows runs the low-level
    /// hooks while an event is being injected, so injecting while holding a lock the hook also
    /// wants would stall input. Everything is therefore queued to one dedicated thread, which
    /// holds no locks and keeps the events in order.
    /// </summary>
    static class Injector
    {
        static readonly System.Collections.Concurrent.BlockingCollection<Action> Queue =
            new System.Collections.Concurrent.BlockingCollection<Action>();

        static Injector()
        {
            var t = new System.Threading.Thread(() =>
            {
                foreach (var a in Queue.GetConsumingEnumerable())
                {
                    try { a(); } catch (Exception ex) { Log.Write("inject: " + ex.Message); }
                }
            });
            t.IsBackground = true; t.Name = "mb-inject";
            t.Start();
        }

        /// <summary>Moves this PC's own cursor (not marked as peer input).</summary>
        public static void Warp(int x, int y) => Queue.Add(() => Native.SetCursorPos(x, y));

        static readonly IntPtr Tag = new IntPtr(0x4D425247); // "MBRG"
        const uint MOVE = 0x1, WHEEL = 0x800, HWHEEL = 0x1000, VIRTUALDESK = 0x4000, ABSOLUTE = 0x8000;
        static readonly uint[] Down = { 0x2, 0x8, 0x20, 0x80, 0x80 };
        static readonly uint[] Up = { 0x4, 0x10, 0x40, 0x100, 0x100 };

        static void Send(Native.INPUT input)
            => Queue.Add(() => Native.SendInput(1, new[] { input }, Marshal.SizeOf(typeof(Native.INPUT))));

        static Native.INPUT Mouse(int dx, int dy, uint data, uint flags)
        {
            var i = new Native.INPUT { type = 0 };
            i.U.mi = new Native.MOUSEINPUT { dx = dx, dy = dy, mouseData = data, dwFlags = flags, dwExtraInfo = Tag };
            return i;
        }

        public static void MoveTo(int x, int y)
        {
            var v = Native.VirtualScreen();
            int nx = (int)Math.Round((x - v.Left) * 65535.0 / Math.Max(1, v.Width - 1));
            int ny = (int)Math.Round((y - v.Top) * 65535.0 / Math.Max(1, v.Height - 1));
            Send(Mouse(nx, ny, 0, MOVE | ABSOLUTE | VIRTUALDESK));
        }

        public static void Button(int button, bool down)
        {
            if (button < 0 || button > 4) return;
            uint data = button == 3 ? 1u : button == 4 ? 2u : 0u;
            Send(Mouse(0, 0, data, down ? Down[button] : Up[button]));
        }

        public static void Wheel(int delta, bool horizontal)
            => Send(Mouse(0, 0, unchecked((uint)delta), horizontal ? HWHEEL : WHEEL));

        public static void Key(int scan, bool extended, bool down, int vk)
        {
            var i = new Native.INPUT { type = 1 };
            uint flags = down ? 0u : 0x2u;                // KEYEVENTF_KEYUP
            if (extended) flags |= 0x1;                   // KEYEVENTF_EXTENDEDKEY
            if (scan != 0)
                i.U.ki = new Native.KEYBDINPUT { wScan = (ushort)scan, dwFlags = flags | 0x8, dwExtraInfo = Tag }; // SCANCODE
            else
                i.U.ki = new Native.KEYBDINPUT { wVk = (ushort)vk, dwFlags = flags, dwExtraInfo = Tag };
            Send(i);
        }
    }
}
