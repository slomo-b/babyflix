//! Native video surface ("stage") for the embedded MPV engine.
//!
//! BabyFlix draws its UI in HTML and hands MPV a *native* rectangle to paint
//! into. WebKitGTK never creates an X11 child window of its own, so an HTML
//! overlay would always sit *under* the video: the controls therefore live
//! around the stage (chrome layout) instead of on top of it.
//!
//! Modes
//! -----
//! * [`Mode::ChildWindow`] (X11, Windows): we create a real native child
//!   window of the app window and hand it to `mpv --wid=<id>`.
//! * [`Mode::OwnWindow`] (macOS, Wayland, anything else): MPV gets its own
//!   borderless, always-on-top window which we position over the stage
//!   rectangle (see [`crate::mpv::Mpv::dock`]).

use anyhow::Result;
use serde::Serialize;

/// Physical-pixel rectangle. Child-window mode: relative to the client area of
/// the host window. Own-window mode: absolute screen coordinates.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    /// Never hand MPV a zero/negative size - some VOs fail to init on that.
    pub fn sized(self) -> Rect {
        Rect {
            w: self.w.max(2),
            h: self.h.max(2),
            ..self
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    ChildWindow,
    OwnWindow,
}

impl Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Mode::ChildWindow => "child-window",
            Mode::OwnWindow => "own-window",
        }
    }
}

/// Which flavour of native handle the app window gave us.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostKind {
    Xlib,
    Xcb,
    Win32,
    AppKit,
    Wayland,
    Other,
}

#[derive(Clone, Copy, Debug)]
pub struct Host {
    pub kind: HostKind,
    pub native: u64,
}

impl Host {
    /// Can MPV paint into a child window of this host?
    pub fn embeddable(&self) -> bool {
        matches!(self.kind, HostKind::Xlib | HostKind::Xcb | HostKind::Win32)
    }
}

/// Pull the raw native window id out of the app window.
pub fn host_handle<W: raw_window_handle::HasWindowHandle>(w: &W) -> Option<Host> {
    use raw_window_handle::RawWindowHandle;
    let handle = w.window_handle().ok()?;
    let (kind, native) = match handle.as_raw() {
        // `Xlib`'s window is `c_ulong` – 32-bit on Windows, 64-bit elsewhere –
        // so cast every arm to u64 to keep the tuple type stable.
        RawWindowHandle::Xlib(h) => (HostKind::Xlib, h.window as u64),
        RawWindowHandle::Xcb(h) => (HostKind::Xcb, h.window.get() as u64),
        RawWindowHandle::Win32(h) => (HostKind::Win32, h.hwnd.get() as u64),
        RawWindowHandle::AppKit(_) => (HostKind::AppKit, 0),
        RawWindowHandle::Wayland(_) => (HostKind::Wayland, 0),
        _ => (HostKind::Other, 0),
    };
    Some(Host { kind, native })
}

/// The native surface MPV paints into (child-window mode) or a placeholder for
/// own-window mode.
pub struct Stage {
    inner: Option<imp::Window>,
    mode: Mode,
    rect: Rect,
    visible: bool,
}

impl Stage {
    /// Reserve a native surface. Never fails hard: without a usable native
    /// handle we degrade to [`Mode::OwnWindow`] and MPV positions its own
    /// window instead.
    pub fn create(host: Option<Host>, rect: Rect) -> Stage {
        let rect = rect.sized();
        let inner = host.and_then(|h| {
            if h.embeddable() {
                imp::Window::create(h, rect)
            } else {
                None
            }
        });
        let mode = if inner.is_some() {
            Mode::ChildWindow
        } else {
            Mode::OwnWindow
        };
        let mut stage = Stage {
            inner,
            mode,
            rect,
            visible: false,
        };
        if let Some(w) = &stage.inner {
            w.set_visible(false);
        }
        stage.visible = false;
        stage
    }

    pub fn mode(&self) -> Mode {
        self.mode
    }

    /// Native id for `mpv --wid=<id>` (child-window mode only).
    pub fn wid(&self) -> Option<u64> {
        self.inner.as_ref().map(|w| w.id())
    }

    pub fn set_rect(&mut self, r: Rect) {
        let r = r.sized();
        self.rect = r;
        if let Some(w) = &self.inner {
            w.set_rect(r);
        }
    }

    pub fn set_visible(&mut self, yes: bool) {
        if self.visible == yes && self.inner.is_some() {
            return;
        }
        self.visible = yes;
        if let Some(w) = &self.inner {
            w.set_visible(yes);
        }
    }

    /// Put the stage at the very bottom of the z-order so the webview keeps
    /// painting above it (Windows needs this, X11 tolerates it).
    pub fn sink(&self) {
        if let Some(w) = &self.inner {
            w.sink();
        }
    }

    pub fn destroy(&mut self) {
        if let Some(w) = self.inner.take() {
            w.destroy();
        }
    }
}

// ---------------------------------------------------------------------------
// X11 (Linux)
// ---------------------------------------------------------------------------
#[cfg(target_os = "linux")]
mod imp {
    use super::{Host, HostKind, Rect};
    use x11_dl::xlib;

    pub struct Window {
        xlib: xlib::Xlib,
        dpy: *mut xlib::Display,
        win: xlib::Window,
    }

    // The Xlib connection is only touched through `Stage`, which lives behind a
    // mutex, and `XInitThreads` is called before the first connection.
    unsafe impl Send for Window {}
    unsafe impl Sync for Window {}

    impl Window {
        pub fn create(host: Host, rect: Rect) -> Option<Window> {
            if host.kind != HostKind::Xlib && host.kind != HostKind::Xcb {
                return None;
            }
            let xlib = xlib::Xlib::open().ok()?;
            unsafe {
                use std::sync::Once;
                static INIT: Once = Once::new();
                INIT.call_once(|| {
                    (xlib.XInitThreads)();
                });
                let dpy = (xlib.XOpenDisplay)(std::ptr::null());
                if dpy.is_null() {
                    return None;
                }
                let screen = (xlib.XDefaultScreen)(dpy);
                let black = (xlib.XBlackPixel)(dpy, screen);
                let win = (xlib.XCreateSimpleWindow)(
                    dpy,
                    host.native,
                    rect.x,
                    rect.y,
                    rect.w as u32,
                    rect.h as u32,
                    0,
                    black,
                    black,
                );
                if win == 0 {
                    (xlib.XCloseDisplay)(dpy);
                    return None;
                }
                (xlib.XSetWindowBackground)(dpy, win, black);
                (xlib.XSync)(dpy, 0);
                Some(Window { xlib, dpy, win })
            }
        }

        pub fn id(&self) -> u64 {
            self.win
        }

        pub fn set_rect(&self, r: Rect) {
            unsafe {
                (self.xlib.XMoveResizeWindow)(
                    self.dpy,
                    self.win,
                    r.x,
                    r.y,
                    r.w as u32,
                    r.h as u32,
                );
                (self.xlib.XSync)(self.dpy, 0);
            }
        }

        pub fn set_visible(&self, yes: bool) {
            unsafe {
                if yes {
                    (self.xlib.XMapWindow)(self.dpy, self.win);
                    (self.xlib.XLowerWindow)(self.dpy, self.win);
                } else {
                    (self.xlib.XUnmapWindow)(self.dpy, self.win);
                }
                (self.xlib.XSync)(self.dpy, 0);
            }
        }

        pub fn sink(&self) {
            unsafe {
                (self.xlib.XLowerWindow)(self.dpy, self.win);
                (self.xlib.XSync)(self.dpy, 0);
            }
        }

        pub fn destroy(&self) {
            unsafe {
                (self.xlib.XDestroyWindow)(self.dpy, self.win);
                (self.xlib.XSync)(self.dpy, 0);
                (self.xlib.XCloseDisplay)(self.dpy);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Windows (user32, raw FFI - no extra crate, no API drift)
// ---------------------------------------------------------------------------
#[cfg(windows)]
mod imp {
    use super::{Host, HostKind, Rect};
    use std::ffi::c_void;

    type Hwnd = isize;
    type Hinstance = isize;

    const WS_CHILD: u32 = 0x4000_0000;
    const WS_VISIBLE: u32 = 0x1000_0000;
    const WS_CLIPSIBLINGS: u32 = 0x0400_0000;
    const SW_SHOWNOACTIVATE: i32 = 4;
    const SW_HIDE: i32 = 0;
    const HWND_BOTTOM: Hwnd = 1;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOACTIVATE: u32 = 0x0010;

    #[link(name = "user32")]
    extern "system" {
        fn CreateWindowExW(
            ex: u32,
            class: *const u16,
            name: *const u16,
            style: u32,
            x: i32,
            y: i32,
            w: i32,
            h: i32,
            parent: Hwnd,
            menu: Hwnd,
            instance: Hinstance,
            param: *mut c_void,
        ) -> Hwnd;
        fn DestroyWindow(h: Hwnd) -> i32;
        fn MoveWindow(h: Hwnd, x: i32, y: i32, w: i32, h: i32, repaint: i32) -> i32;
        fn ShowWindow(h: Hwnd, cmd: i32) -> i32;
        fn SetWindowPos(
            h: Hwnd,
            after: Hwnd,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            flags: u32,
        ) -> i32;
    }

    /// "STATIC" as a NUL-terminated UTF-16 literal.
    const CLASS: [u16; 7] = [0x53, 0x54, 0x41, 0x54, 0x49, 0x43, 0];

    pub struct Window {
        hwnd: Hwnd,
        parent: Hwnd,
    }

    unsafe impl Send for Window {}
    unsafe impl Sync for Window {}

    impl Window {
        pub fn create(host: Host, rect: Rect) -> Option<Window> {
            if host.kind != HostKind::Win32 {
                return None;
            }
            let parent = host.native as Hwnd;
            unsafe {
                let hwnd = CreateWindowExW(
                    0,
                    CLASS.as_ptr(),
                    CLASS.as_ptr(),
                    WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS,
                    rect.x,
                    rect.y,
                    rect.w,
                    rect.h,
                    parent,
                    0,
                    0,
                    std::ptr::null_mut(),
                );
                if hwnd == 0 {
                    return None;
                }
                // Keep the webview (in the parent) above the video.
                SetWindowPos(
                    hwnd,
                    HWND_BOTTOM,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
                Some(Window { hwnd, parent })
            }
        }

        pub fn id(&self) -> u64 {
            self.hwnd as u64
        }

        pub fn set_rect(&self, r: Rect) {
            unsafe {
                MoveWindow(self.hwnd, r.x, r.y, r.w, r.h, 1);
            }
        }

        pub fn set_visible(&self, yes: bool) {
            unsafe {
                ShowWindow(self.hwnd, if yes { SW_SHOWNOACTIVATE } else { SW_HIDE });
            }
        }

        pub fn sink(&self) {
            unsafe {
                let _ = self.parent;
                SetWindowPos(
                    self.hwnd,
                    HWND_BOTTOM,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
        }

        pub fn destroy(&self) {
            unsafe {
                DestroyWindow(self.hwnd);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Everything else (macOS et al.): no native child window, MPV uses its own.
// ---------------------------------------------------------------------------
#[cfg(not(any(target_os = "linux", windows)))]
mod imp {
    use super::{Host, Rect};

    pub struct Window;

    impl Window {
        pub fn create(_host: Host, _rect: Rect) -> Option<Window> {
            None
        }
        pub fn id(&self) -> u64 {
            0
        }
        pub fn set_rect(&self, _r: Rect) {}
        pub fn set_visible(&self, _yes: bool) {}
        pub fn sink(&self) {}
        pub fn destroy(&self) {}
    }
}

/// The stage rectangle the UI asked for, in screen coordinates - used by
/// own-window mode through `mpv --geometry`.
pub fn geometry_arg(r: Rect) -> String {
    format!("{}x{}+{}+{}", r.w.max(2), r.h.max(2), r.x, r.y)
}

/// Was this a "nothing to do" error from a platform that cannot embed?
#[allow(dead_code)]
pub fn unsupported() -> Result<()> {
    anyhow::bail!("embedding not supported on this platform")
}
