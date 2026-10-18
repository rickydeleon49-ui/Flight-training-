// Reviewer-only adapter: use with current proof, renaming main to original_main.
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("worker") {
        let mode = args.last().map(String::as_str).unwrap_or("");
        if mode.starts_with("review-trailing-") {
            let mut normal = args[2..].to_vec();
            normal[5] = "normal".into();
            let code = worker(&normal);
            assert_eq!(code, 0);
            let mut out = io::stdout().lock();
            match mode {
                "review-trailing-frame" => emit(&mut out, &json!({"type":"page", "physicalPage":2, "status":"text", "text":"late"})),
                "review-trailing-invalid" => out.write_all(b"not-json\n").unwrap(),
                "review-trailing-partial" => out.write_all(b"{\"type\":").unwrap(),
                _ => panic!("unknown adapter"),
            }
            out.flush().unwrap();
            return;
        }
    }
    if args.get(1).map(String::as_str) == Some("review-trailing-case") {
        let mode = &args[2];
        let scratch = Path::new(&args[3]);
        assert!(!scratch.exists());
        fs::create_dir_all(scratch).unwrap();
        let pdf = scratch.join("one.pdf");
        fs::write(&pdf, text_pages(1, 9)).unwrap();
        let mut sup = Supervisor::new(std::env::current_exe().unwrap(), scratch.join("workers"));
        let limits = Limits { deadline:Duration::from_secs(2),rss_kib:None,..Limits::proof() };
        let id = sup.start(request("review", &pdf, limits, mode));
        // Observe an already-exited worker before settling. This deterministically
        // models the supervisor being scheduled after the child has finished.
        let started = Instant::now();
        if let Some((_, Slot::Running(r))) = sup.slots.get_mut(&id) {
            loop {
                if r.child.try_wait().unwrap().is_some() { break; }
                assert!(started.elapsed() < Duration::from_secs(1));
                thread::sleep(Duration::from_millis(1));
            }
        }
        let s = sup.settle(id);
        let publication = sup.publish(&s);
        println!("{}",json!({"mode":mode,"settled":settled_json(&s),"publication":format!("{publication:?}"),"indexed":sup.indexed.len()}));
        return;
    }
    original_main();
}
