using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace MouseBridge.App
{
    /// <summary>
    /// Low-level mouse and keyboard hooks on their own thread. Windows silently removes a
    /// hook whose thread stalls, so nothing slow (UI, clipboard, files) may share this thread.
    /// Handlers return true to swallow the event.
    /// </summary>
    sealed class InputHook
    {
        public Func<int, Native.MSLLHOOKSTRUCT, bool> Mouse;
        public Func<Native.KBDLLHOOKSTRUCT, bool> Key;

        Native.HookProc _mouseProc, _keyProc; // kept alive for the lifetime of the hooks
        IntPtr _mouseHook, _keyHook;

        public void Start()
        {
            var t = new Thread(() =>
            {
                _mouseProc = MouseProc; _keyProc = KeyProc;
                IntPtr mod = Native.GetModuleHandle(null);
                _mouseHook = Native.SetWindowsHookEx(Native.WH_MOUSE_LL, _mouseProc, mod, 0);
                _keyHook = Native.SetWindowsHookEx(Native.WH_KEYBOARD_LL, _keyProc, mod, 0);
                if (_mouseHook == IntPtr.Zero || _keyHook == IntPtr.Zero)
                    Log.Write("hook install failed: " + Marshal.GetLastWin32Error());
                Application.Run(); // message pump that delivers the hook callbacks
                Native.UnhookWindowsHookEx(_mouseHook);
                Native.UnhookWindowsHookEx(_keyHook);
            });
            t.IsBackground = true; t.Name = "mb-hook";
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
        }

        IntPtr MouseProc(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                try
                {
                    var m = (Native.MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(Native.MSLLHOOKSTRUCT));
                    if (Mouse != null && Mouse((int)wParam, m)) return new IntPtr(1);
                }
                catch (Exception ex) { Log.Write("mouse hook: " + ex); }
            }
            return Native.CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
        }

        IntPtr KeyProc(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                try
                {
                    var k = (Native.KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(Native.KBDLLHOOKSTRUCT));
                    if (Key != null && Key(k)) return new IntPtr(1);
                }
                catch (Exception ex) { Log.Write("key hook: " + ex); }
            }
            return Native.CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
        }
    }
}
