// Baseline-only adapters appended to the REVIEWED 9b202c0 source (its main
// renamed to original_main). The reviewed Supervisor is unchanged.
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("worker") && args.last().map(String::as_str) == Some("baseline-done-stall") {
        let mut a = args[2..].to_vec();
        *a.last_mut().unwrap() = "normal".into();
        let _ = worker(&a);
        loop {
            thread::sleep(Duration::from_secs(60));
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
        if mode == "baseline-r4-prespawn" {
            // R4: an over-limit input should be refused before any worker exists.
            let limits = Limits { input: 64, ..Limits::proof() };
            let s = sup.run(request("r4", &pdf, limits, "normal"));
            println!("{}", json!({"settled": settled_json(&s), "workersSpawned": sup.records.len()}));
            return;
        }
        let limits = Limits { deadline: Duration::from_millis(200), rss_kib: None, ..Limits::proof() };
        let s = sup.run(request("review", &pdf, limits, mode));
        let publication = sup.publish(&s);
        println!("{}", json!({"settled": settled_json(&s), "publication": format!("{publication:?}"), "indexed": sup.indexed.len()}));
        return;
    }
    original_main();
}
