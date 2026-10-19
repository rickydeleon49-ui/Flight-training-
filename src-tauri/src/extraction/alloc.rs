//! The counting allocator behind the extraction worker's memory cap
//! (OFFLINE-01 proposal §4.2).
//!
//! It counts the *requested* bytes of live Rust heap allocations from process
//! start. As soon as the process knows it is the app, not a worker, counting
//! stops for good and every allocation goes straight to the system allocator:
//! a shared counter contends badly across the app's many threads. In worker
//! mode counting continues, a cap is set before any input is read, and a
//! reservation that would pass it returns null. That is
//! a bound on requested allocation bytes, not on heap footprint or RSS:
//! allocator metadata, rounding, fragmentation and retained pages are outside
//! the count.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

/// No cap: the value the app runs with.
const UNCAPPED: usize = usize::MAX;

/// The marker a breach writes to standard error, once. Static, so writing it
/// needs no allocation.
pub const BREACH_MARKER: &[u8] = b"HFD-EXTRACT-MEMORY-LIMIT\n";

pub struct Counting {
    /// True until the process is known to be the app; then never again.
    counting: AtomicBool,
    live: AtomicUsize,
    cap: AtomicUsize,
    breached: AtomicBool,
    /// Where the one-shot marker goes; `None` in tests that only count.
    signal_fd: Option<i32>,
}

impl Counting {
    pub const fn new(signal_fd: Option<i32>) -> Self {
        Self {
            counting: AtomicBool::new(true),
            live: AtomicUsize::new(0),
            cap: AtomicUsize::new(UNCAPPED),
            breached: AtomicBool::new(false),
            signal_fd,
        }
    }

    /// The app has no cap: stop counting, permanently. Frees of memory
    /// counted earlier are not credited afterwards, so the counter can never
    /// underflow; it is simply never consulted again. Refused once a cap is
    /// set, so a worker can never stop its own accounting.
    pub fn stop_counting(&self) -> bool {
        if self.cap.load(Ordering::Acquire) != UNCAPPED {
            return false;
        }
        self.counting.store(false, Ordering::Release);
        true
    }

    #[inline]
    fn active(&self) -> bool {
        self.counting.load(Ordering::Relaxed)
    }

    /// Requested bytes of live allocations.
    pub fn live(&self) -> usize {
        self.live.load(Ordering::Acquire)
    }

    pub fn breached(&self) -> bool {
        self.breached.load(Ordering::Acquire)
    }

    /// Set the worker's cap. Returns false, after signalling a breach, if the
    /// counter is already above it.
    pub fn set_cap(&self, cap: usize) -> bool {
        self.cap.store(cap, Ordering::Release);
        if self.live() > cap {
            self.breach();
            return false;
        }
        true
    }

    /// Apply `f` to the counter atomically; `None` from `f` leaves it as is.
    /// (A compare-and-swap loop: `fetch_update` is deprecated on newer
    /// compilers, and its replacement is newer than the supported 1.77.)
    fn update(&self, f: impl Fn(usize) -> Option<usize>) -> bool {
        let mut live = self.live.load(Ordering::Acquire);
        loop {
            let Some(next) = f(live) else { return false };
            match self
                .live
                .compare_exchange_weak(live, next, Ordering::AcqRel, Ordering::Acquire)
            {
                Ok(_) => return true,
                Err(actual) => live = actual,
            }
        }
    }

    /// Reserve `bytes` without passing the cap. Overflow counts as a breach.
    fn reserve(&self, bytes: usize) -> bool {
        let cap = self.cap.load(Ordering::Acquire);
        if !self.update(|live| live.checked_add(bytes).filter(|next| *next <= cap)) {
            self.breach();
            return false;
        }
        true
    }

    fn release(&self, bytes: usize) {
        if !self.update(|live| live.checked_sub(bytes)) {
            // A credit larger than what is live means the accounting is
            // wrong; continuing would make the cap meaningless.
            std::process::abort();
        }
    }

    /// Sticky, one-shot breach signal: set the flag, then write the static
    /// marker once with a raw write. Never allocates.
    fn breach(&self) {
        if self.breached.swap(true, Ordering::AcqRel) {
            return;
        }
        if let Some(fd) = self.signal_fd {
            write_marker(fd);
        }
    }

    // The four operations, against any inner allocator, so tests can drive
    // them without replacing the process's global allocator.

    /// # Safety
    /// As `GlobalAlloc::alloc`.
    pub unsafe fn alloc_with<A: GlobalAlloc>(
        &self,
        inner: &A,
        layout: Layout,
        zeroed: bool,
    ) -> *mut u8 {
        if !self.active() {
            return if zeroed {
                inner.alloc_zeroed(layout)
            } else {
                inner.alloc(layout)
            };
        }
        if !self.reserve(layout.size()) {
            return std::ptr::null_mut();
        }
        let ptr = if zeroed {
            inner.alloc_zeroed(layout)
        } else {
            inner.alloc(layout)
        };
        if ptr.is_null() {
            self.release(layout.size());
        }
        ptr
    }

    /// # Safety
    /// As `GlobalAlloc::dealloc`.
    pub unsafe fn dealloc_with<A: GlobalAlloc>(&self, inner: &A, ptr: *mut u8, layout: Layout) {
        inner.dealloc(ptr, layout);
        if self.active() {
            self.release(layout.size());
        }
    }

    /// Growth is reserved before the call and rolled back if it fails;
    /// shrinkage is credited only after success, so the counter never runs
    /// ahead of a still-live larger block.
    ///
    /// # Safety
    /// As `GlobalAlloc::realloc`.
    pub unsafe fn realloc_with<A: GlobalAlloc>(
        &self,
        inner: &A,
        ptr: *mut u8,
        layout: Layout,
        new_size: usize,
    ) -> *mut u8 {
        if !self.active() {
            return inner.realloc(ptr, layout, new_size);
        }
        let old = layout.size();
        if new_size > old {
            let growth = new_size - old;
            if !self.reserve(growth) {
                return std::ptr::null_mut();
            }
            let moved = inner.realloc(ptr, layout, new_size);
            if moved.is_null() {
                self.release(growth);
            }
            moved
        } else {
            let moved = inner.realloc(ptr, layout, new_size);
            if !moved.is_null() {
                self.release(old - new_size);
            }
            moved
        }
    }
}

#[cfg(unix)]
extern "C" {
    fn write(fd: i32, buf: *const std::ffi::c_void, count: usize) -> isize;
}

/// Elsewhere a breach is reported as a plain worker failure.
#[cfg(not(unix))]
fn write_marker(_fd: i32) {}

/// Write the marker with bounded retries on interruption and partial writes.
/// Any other error abandons signalling; the supervisor then reports a plain
/// worker failure, never success.
#[cfg(unix)]
fn write_marker(fd: i32) {
    const EINTR: i32 = 4;
    let mut written = 0;
    let mut attempts = 0;
    while written < BREACH_MARKER.len() && attempts < 8 {
        attempts += 1;
        // SAFETY: the buffer is a static slice and the length stays in range.
        let n = unsafe {
            write(
                fd,
                BREACH_MARKER.as_ptr().add(written).cast(),
                BREACH_MARKER.len() - written,
            )
        };
        if n > 0 {
            written += n as usize;
        } else if n < 0 && std::io::Error::last_os_error().raw_os_error() == Some(EINTR) {
            continue;
        } else {
            return;
        }
    }
}

/// The process-wide allocator: counting always, capped only in worker mode.
pub struct Global;

/// Standard error, where the supervisor looks for the marker.
pub static COUNTER: Counting = Counting::new(Some(2));

unsafe impl GlobalAlloc for Global {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        COUNTER.alloc_with(&System, layout, false)
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        COUNTER.alloc_with(&System, layout, true)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        COUNTER.dealloc_with(&System, ptr, layout)
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        COUNTER.realloc_with(&System, ptr, layout, new_size)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn layout(n: usize) -> Layout {
        Layout::from_size_align(n, 8).unwrap()
    }

    #[test]
    fn counts_alloc_zeroed_and_dealloc() {
        let c = Counting::new(None);
        unsafe {
            let a = c.alloc_with(&System, layout(100), false);
            let z = c.alloc_with(&System, layout(50), true);
            assert_eq!(c.live(), 150);
            assert_eq!(*z, 0);
            c.dealloc_with(&System, a, layout(100));
            c.dealloc_with(&System, z, layout(50));
        }
        assert_eq!(c.live(), 0);
    }

    #[test]
    fn app_mode_stops_counting_for_good_and_never_underflows() {
        let c = Counting::new(None);
        unsafe {
            let early = c.alloc_with(&System, layout(64), false);
            assert_eq!(c.live(), 64);
            assert!(c.stop_counting());
            let later = c.alloc_with(&System, layout(1 << 20), false);
            assert_eq!(c.live(), 64, "nothing is counted once stopped");
            c.dealloc_with(&System, early, layout(64));
            c.dealloc_with(&System, later, layout(1 << 20));
            assert_eq!(c.live(), 64, "frees are not credited, so no underflow");
        }
    }

    #[test]
    fn a_capped_worker_cannot_stop_its_own_accounting() {
        let c = Counting::new(None);
        assert!(c.set_cap(1 << 20));
        assert!(!c.stop_counting());
        unsafe {
            assert!(c.alloc_with(&System, layout(2 << 20), false).is_null());
        }
        assert!(c.breached());
    }

    #[test]
    fn cap_refuses_and_breach_is_sticky() {
        let c = Counting::new(None);
        assert!(c.set_cap(128));
        unsafe {
            let a = c.alloc_with(&System, layout(100), false);
            assert!(!a.is_null());
            assert!(c.alloc_with(&System, layout(64), false).is_null());
            assert!(c.breached());
            assert_eq!(c.live(), 100, "a refused reservation is not counted");
            c.dealloc_with(&System, a, layout(100));
        }
        assert!(c.breached(), "the flag stays set after memory is freed");
    }

    #[test]
    fn realloc_growth_is_reserved_and_shrink_credited_after_success() {
        let c = Counting::new(None);
        assert!(c.set_cap(1000));
        unsafe {
            let p = c.alloc_with(&System, layout(100), false);
            let p = c.realloc_with(&System, p, layout(100), 400);
            assert_eq!(c.live(), 400);
            assert!(c.realloc_with(&System, p, layout(400), 2000).is_null());
            assert_eq!(
                c.live(),
                400,
                "failed growth is rolled back; the block keeps its count"
            );
            let p = c.realloc_with(&System, p, layout(400), 40);
            assert_eq!(c.live(), 40);
            c.dealloc_with(&System, p, layout(40));
        }
        assert_eq!(c.live(), 0);
    }

    /// An inner allocator that always fails, to prove reservations roll back.
    struct Failing;
    unsafe impl GlobalAlloc for Failing {
        unsafe fn alloc(&self, _: Layout) -> *mut u8 {
            std::ptr::null_mut()
        }
        unsafe fn dealloc(&self, _: *mut u8, _: Layout) {}
        unsafe fn realloc(&self, _: *mut u8, _: Layout, _: usize) -> *mut u8 {
            std::ptr::null_mut()
        }
    }

    #[test]
    fn system_failure_releases_the_reservation() {
        let c = Counting::new(None);
        unsafe {
            assert!(c.alloc_with(&Failing, layout(64), false).is_null());
            assert_eq!(c.live(), 0);
            let p = c.alloc_with(&System, layout(16), false);
            assert!(c.realloc_with(&Failing, p, layout(16), 64).is_null());
            assert_eq!(c.live(), 16);
            c.dealloc_with(&System, p, layout(16));
        }
        assert!(!c.breached(), "a system failure is not a cap breach");
    }

    #[test]
    fn overflowing_reservation_is_a_breach() {
        let c = Counting::new(None);
        unsafe {
            let p = c.alloc_with(&System, layout(8), false);
            assert!(!c.reserve(usize::MAX));
            assert!(c.breached());
            c.dealloc_with(&System, p, layout(8));
        }
    }

    #[test]
    fn set_cap_below_live_bytes_breaches_immediately() {
        let c = Counting::new(None);
        unsafe {
            let p = c.alloc_with(&System, layout(64), false);
            assert!(!c.set_cap(32));
            assert!(c.breached());
            c.dealloc_with(&System, p, layout(64));
        }
    }

    /// App-mode cost of the counting wrapper (no cap). Run in release:
    /// `cargo test --release --lib extraction::alloc -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn measure_app_mode_overhead() {
        const N: usize = 2_000_000;
        fn bench(threads: usize, f: impl Fn() + Send + Sync + Copy + 'static) -> f64 {
            let start = std::time::Instant::now();
            let handles: Vec<_> = (0..threads).map(|_| std::thread::spawn(f)).collect();
            for h in handles {
                h.join().unwrap();
            }
            start.elapsed().as_secs_f64()
        }
        static WRAPPED: Counting = Counting::new(None);
        static APP: Counting = Counting::new(None);
        assert!(APP.stop_counting());
        let plain = || unsafe {
            for i in 0..N {
                let l = Layout::from_size_align(16 + (i % 64), 8).unwrap();
                let p = System.alloc(l);
                std::hint::black_box(p);
                System.dealloc(p, l);
            }
        };
        let counted = || unsafe {
            for i in 0..N {
                let l = Layout::from_size_align(16 + (i % 64), 8).unwrap();
                let p = WRAPPED.alloc_with(&System, l, false);
                std::hint::black_box(p);
                WRAPPED.dealloc_with(&System, p, l);
            }
        };
        let app = || unsafe {
            for i in 0..N {
                let l = Layout::from_size_align(16 + (i % 64), 8).unwrap();
                let p = APP.alloc_with(&System, l, false);
                std::hint::black_box(p);
                APP.dealloc_with(&System, p, l);
            }
        };
        for threads in [1, 4, 8] {
            // Median of five runs each, to damp scheduling noise.
            let median = |f: &dyn Fn() -> f64| {
                let mut v: Vec<f64> = (0..5).map(|_| f()).collect();
                v.sort_by(|a, b| a.partial_cmp(b).unwrap());
                v[2]
            };
            let a = median(&|| bench(threads, plain));
            let b = median(&|| bench(threads, app));
            let c = median(&|| bench(threads, counted));
            println!(
                "threads={threads} pairs/thread={N} system={a:.4}s app_mode={b:.4}s ({:+.1}%) counting={c:.4}s ({:+.1}%)",
                (b / a - 1.0) * 100.0,
                (c / a - 1.0) * 100.0
            );
        }
    }

    #[test]
    fn concurrent_reservations_never_jointly_pass_the_cap() {
        let c = Arc::new(Counting::new(None));
        assert!(c.set_cap(64 * 100));
        let granted: usize = (0..8)
            .map(|_| {
                let c = c.clone();
                std::thread::spawn(move || (0..100).filter(|_| c.reserve(64)).count())
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|t| t.join().unwrap())
            .sum();
        assert_eq!(granted, 100, "exactly the cap's worth is granted");
        assert_eq!(c.live(), 64 * 100);
    }
}
