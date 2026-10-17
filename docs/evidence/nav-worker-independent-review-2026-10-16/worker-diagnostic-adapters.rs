// Review-only worker fault adapters. The Supervisor implementation above is unchanged.
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("worker") {
        match args.last().map(String::as_str) {
            Some("review-eof-stall") => {
                unsafe extern "C" { fn close(fd: i32) -> i32; }
                unsafe { close(1); }
                thread::sleep(Duration::from_secs(60));
                return;
            }
            Some("review-done-nonzero") => {
                let mut a = args[2..].to_vec();
                *a.last_mut().unwrap() = "normal".into();
                let _ = worker(&a);
                std::process::exit(3);
            }
            _ => {}
        }
    }
    if args.get(1).map(String::as_str) == Some("review-case") {
        let mode = &args[2];
        let scratch = Path::new(&args[3]);
        assert!(!scratch.exists());
        fs::create_dir_all(scratch).unwrap();
        let pdf = scratch.join("one.pdf");
        fs::write(&pdf, text_pages(1, 9)).unwrap();
        let mut sup = Supervisor::new(std::env::current_exe().unwrap(), scratch.join("workers"));
        let limits = Limits { deadline: Duration::from_millis(200), rss_kib: None, ..Limits::proof() };
        let s = sup.run(request("review", &pdf, limits, mode));
        let publication = sup.publish(&s);
        println!("{}", json!({"settled":settled_json(&s), "publication":format!("{publication:?}"), "indexed":sup.indexed.len()}));
        return;
    }
    original_main();
}
