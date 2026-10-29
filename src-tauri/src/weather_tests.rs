use super::*;
use serde_json::json;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};

fn metar() -> Value {
    json!({"icaoId":"KZZZ", "name":"Imaginary Learning Field", "rawOb":"METAR KZZZ 281200Z 22007G12KT P6SM FEW040 M02/M05 A2992 RMK SYNTHETIC", "obsTime":1793188800, "wdir":220, "wspd":7, "wgst":12, "visib":"6+", "temp":-2, "altim":1013.2})
}
fn taf() -> Value {
    json!({"icaoId":"KZZZ", "name":"Imaginary Learning Field", "rawTAF":"TAF AMD KZZZ 281100Z 2812/2912 22007KT P6SM TEMPO 2813/2815 3SM BKN020", "issueTime":"2026-10-28T11:00:00.000Z", "validTimeFrom":1793188800i64, "validTimeTo":1793275200i64, "fcsts":[{"timeFrom":1793192400i64,"timeTo":1793199600i64,"fcstChange":"TEMPO","probability":30,"wspd":7,"wdir":220,"visib":3}]})
}
fn parse(value: Value, product: Product) -> Result<Option<Report>, Failure> {
    decode(
        &serde_json::to_vec(&value).unwrap(),
        "KZZZ",
        product,
        1793192400000,
    )
}
#[test]
fn weather_icao_rejects_selectors_urls_controls_and_unicode() {
    assert_eq!(icao(" kZzz ").unwrap(), "KZZZ");
    for bad in [
        "ZZZ",
        "KZZ1",
        "KZZZ,KZZB",
        "https://KZZZ",
        "KZ\nZ",
        "\nKZZZ",
        "KZZZ\t",
        "ＫZZZ",
        "KßZ",
        "",
        "@CA",
    ] {
        assert!(icao(bad).is_err(), "{bad}");
    }
    assert_eq!(
        url("KZZZ", Product::Metar),
        "https://aviationweather.gov/api/data/metar?ids=KZZZ&format=json&hours=2"
    );
    assert_eq!(
        url("KZZZ", Product::Taf),
        "https://aviationweather.gov/api/data/taf?ids=KZZZ&format=json&time=valid"
    );
}
#[test]
fn weather_station_mismatch_never_publishes() {
    let mut value = metar();
    value["icaoId"] = "KZZB".into();
    assert_eq!(
        parse(json!([value]), Product::Metar).unwrap_err().kind,
        "mismatch"
    );
    let mut value = metar();
    value["rawOb"] = "SPECI COR KZZB 281200Z NIL".into();
    assert_eq!(
        parse(json!([value]), Product::Metar).unwrap_err().kind,
        "mismatch"
    );
    let mut value = taf();
    value["rawTAF"] = "TAF AMD KZZB 281100Z CNL".into();
    assert!(parse(json!([value]), Product::Taf).is_err());
}
#[test]
fn weather_parser_bounds_shapes_and_preserves_full_raw() {
    let item = metar();
    let report = parse(json!([item.clone()]), Product::Metar)
        .unwrap()
        .unwrap();
    assert_eq!(report.raw, item["rawOb"]);
    assert_eq!(report.name.as_deref(), Some("Imaginary Learning Field"));
    assert!(report.conditions.get("icaoId").is_none());
    assert!(report.conditions.get("fltCat").is_none());
    assert!(parse(json!([]), Product::Taf).unwrap().is_none());
    for value in [json!({}), json!([{}]), json!(vec![metar(); 65])] {
        assert!(parse(value, Product::Metar).is_err());
    }
    for bytes in [b"<html>no</html>".as_slice(), b"[", &[255u8], b""] {
        assert!(decode(bytes, "KZZZ", Product::Metar, 0).is_err());
    }
    assert_eq!(
        decode(&vec![b' '; MAX_BODY + 1], "KZZZ", Product::Metar, 0)
            .unwrap_err()
            .kind,
        "oversize"
    );
    let mut value = metar();
    value["rawOb"] = format!("KZZZ {}", "X".repeat(16 * 1024)).into();
    assert!(parse(json!([value]), Product::Metar).is_err());
    let mut value = taf();
    value["fcsts"] = json!(vec![value["fcsts"][0].clone(); 65]);
    assert!(parse(json!([value]), Product::Taf).is_err());
}
#[test]
fn weather_newest_corrections_nil_cancellation_and_validity() {
    let mut older = metar();
    older["obsTime"] = 1793185200.into();
    let mut corrected = metar();
    corrected["rawOb"] = "SPECI COR KZZZ 281200Z NIL".into();
    for records in [
        json!([older.clone(), corrected.clone(), metar()]),
        json!([metar(), corrected, older]),
    ] {
        assert!(parse(records, Product::Metar).unwrap().unwrap().unavailable);
    }
    let mut cancelled = taf();
    cancelled["issueTime"] = "2026-10-28 12:00:00.000Z".into();
    cancelled["rawTAF"] = "TAF AMD KZZZ 281200Z CNL".into();
    assert!(
        parse(json!([taf(), cancelled]), Product::Taf)
            .unwrap()
            .unwrap()
            .unavailable
    );
    let mut cancelled = taf();
    cancelled["issueTime"] = "2026-10-28T12:00:00Z".into();
    cancelled["rawTAF"] = "TAF AMD KZZZ 281200Z CNL".into();
    let mut future = taf();
    future["issueTime"] = "2026-10-28T13:00:00Z".into();
    future["validTimeFrom"] = 1793275200i64.into();
    future["validTimeTo"] = 1793361600i64.into();
    future["fcsts"] = json!([]);
    assert!(
        parse(json!([taf(), cancelled, future]), Product::Taf)
            .unwrap()
            .unwrap()
            .unavailable
    );
    let report = parse(json!([taf()]), Product::Taf).unwrap().unwrap();
    assert_eq!(report.periods[0]["fcstChange"], "TEMPO");
    assert_eq!(report.periods[0]["probability"], 30);
    let mut invalid = taf();
    invalid["validTimeTo"] = invalid["validTimeFrom"].clone();
    assert!(parse(json!([invalid]), Product::Taf).is_err());
    let mut missing = metar();
    missing["obsTime"] = Value::Null;
    assert!(parse(json!([missing]), Product::Metar)
        .unwrap()
        .unwrap()
        .report_time
        .is_none());
    assert!(issue(Some(&json!("2024-02-29T23:59:00.000Z"))).is_some());
    for bad in [
        "2026-02-29T12:00:00Z",
        "2026-10-28T25:00:00Z",
        "2026-10-28T12:00:00",
        "281200Z",
    ] {
        assert!(issue(Some(&json!(bad))).is_none());
    }
}
#[test]
fn weather_native_opt_in_single_flight_and_monotonic_cooldowns() {
    let now = Instant::now();
    let mut s = State::default();
    assert_eq!(
        s.begin("KZZZ", Product::Metar, 0, now).err().unwrap().kind,
        "cancelled"
    );
    s.enabled = true;
    s.session = 3;
    assert!(s.begin("KZZZ", Product::Metar, 2, now).is_err());
    assert!(s.begin("KZZZ", Product::Metar, 3, now).is_ok());
    assert_eq!(
        s.begin("KZZZ", Product::Taf, 3, now).err().unwrap().kind,
        "busy"
    );
    s.active = None;
    assert!(s
        .begin("KZZZ", Product::Taf, 3, now + Duration::from_secs(1))
        .is_err());
    assert!(s
        .begin("KZZZ", Product::Taf, 3, now + Duration::from_secs(2))
        .is_ok());
    s.active = None;
    assert!(s
        .begin("KZZZ", Product::Metar, 3, now + Duration::from_secs(59))
        .is_err());
    assert!(s
        .begin("KZZZ", Product::Metar, 3, now + Duration::from_secs(60))
        .is_ok());
    let mut r = Err(Failure {
        kind: "rate",
        retry_after_ms: 0,
    });
    s.finish(&mut r, now);
    assert_eq!(r.unwrap_err().retry_after_ms, 60000);
    let mut r = Err(Failure {
        kind: "rate",
        retry_after_ms: 0,
    });
    s.finish(&mut r, now);
    assert_eq!(r.unwrap_err().retry_after_ms, 120000);
    for _ in 0..8 {
        s.finish(&mut Err(failure("rate")), now);
    }
    let mut capped = Err(failure("rate"));
    s.finish(&mut capped, now);
    assert_eq!(capped.unwrap_err().retry_after_ms, 900_000);
    let mut r = Err(Failure {
        kind: "rate",
        retry_after_ms: 3600000,
    });
    s.finish(&mut r, now);
    assert_eq!(r.unwrap_err().retry_after_ms, 3600000);
    assert_eq!(
        crate::gemini_budget::retry_after(Some("123"))
            .unwrap()
            .as_secs(),
        123
    );
    assert!(crate::gemini_budget::retry_after(Some("Tue, 14 Nov 2090 22:13:30 GMT")).is_some());
    assert!(crate::gemini_budget::retry_after(Some("nonsense")).is_none());
    let mut r = Err(failure("timeout"));
    s.finish(&mut r, now);
    assert_eq!(r.unwrap_err().retry_after_ms, 30000);
}
// One synthetic response on loopback, never an AWC call. Stop-aware shared readiness
// waits let timeout/cancellation probes finish without fixed polling loops.
struct Server {
    url: String,
    requests: Arc<Mutex<Vec<String>>>,
    stop: Arc<AtomicBool>,
    done: Arc<AtomicBool>,
}
impl Server {
    fn new(response: Vec<u8>, stall: bool) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}/fixture", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let done = Arc::new(AtomicBool::new(false));
        let (r, s, d) = (requests.clone(), stop.clone(), done.clone());
        std::thread::spawn(move || {
            let mut stream = None;
            crate::test_wait::wait_for("weather fixture connection", || {
                if s.load(Ordering::SeqCst) {
                    return true;
                }
                match listener.accept() {
                    Ok((socket, _)) => {
                        stream = Some(socket);
                        true
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => false,
                    Err(e) => panic!("{e}"),
                }
            });
            if let Some(mut socket) = stream {
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut header = Vec::new();
                let mut byte = [0; 1];
                while !header.ends_with(b"\r\n\r\n") && header.len() < 8192 {
                    if socket.read(&mut byte).unwrap_or(0) == 0 {
                        break;
                    }
                    header.push(byte[0]);
                }
                r.lock().unwrap().push(String::from_utf8(header).unwrap());
                let _ = socket.write_all(&response);
                if stall {
                    crate::test_wait::wait_for("weather fixture release", || {
                        s.load(Ordering::SeqCst)
                    });
                }
            }
            d.store(true, Ordering::SeqCst);
        });
        Self {
            url,
            requests,
            stop,
            done,
        }
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        crate::test_wait::wait_for("weather fixture stopped", || {
            self.done.load(Ordering::SeqCst)
        });
    }
}
fn http(status: &str, headers: &str, body: &[u8]) -> Vec<u8> {
    let mut out = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n",
        body.len()
    )
    .into_bytes();
    out.extend(body);
    out
}
fn request(server: &Server, total: Duration) -> Result<Reply, Failure> {
    tauri::async_runtime::block_on(async {
        transport(&client(total).unwrap(), &server.url, "KZZZ", Product::Metar).await
    })
}
#[test]
fn weather_transport_one_get_headers_no_data_and_errors() {
    let body = serde_json::to_vec(&json!([metar()])).unwrap();
    let server = Server::new(
        http("200 OK", "Content-Type: application/json\r\n", &body),
        false,
    );
    assert!(request(&server, TOTAL).unwrap().report.is_some());
    let requests = server.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    let headers = requests[0].to_lowercase();
    assert!(headers.starts_with("get /fixture http/1.1"));
    assert!(headers.contains("accept: application/json"));
    // The version comes from the build, so a release bump never breaks this.
    assert!(headers.contains(&format!(
        "user-agent: herflightdeck/{} (lesson-preparation-weather)",
        env!("CARGO_PKG_VERSION")
    )));
    for forbidden in ["authorization:", "cookie:", "referer:"] {
        assert!(!headers.contains(forbidden));
    }
    drop(requests);
    for response in [
        http("204 No Content", "", b""),
        http("200 OK", "Content-Type: application/json\r\n", b"[]"),
    ] {
        assert!(request(&Server::new(response, false), TOTAL)
            .unwrap()
            .report
            .is_none());
    }
    for (status, kind) in [
        ("400 Bad Request", "unavailable"),
        ("403 Forbidden", "unavailable"),
        ("404 Not Found", "unavailable"),
        ("429 Too Many Requests", "rate"),
        ("503 Unavailable", "server"),
        ("302 Found", "unavailable"),
    ] {
        let server = Server::new(
            http(
                status,
                "Retry-After: 123\r\nLocation: https://example.invalid/\r\n",
                b"secret upstream message",
            ),
            false,
        );
        let error = request(&server, TOTAL).unwrap_err();
        assert_eq!(error.kind, kind);
        if kind == "rate" {
            assert_eq!(error.retry_after_ms, 123000);
        }
        assert!(!format!("{error:?}").contains("secret"));
        assert_eq!(server.requests.lock().unwrap().len(), 1);
    }
}
#[test]
fn weather_transport_bad_bodies_oversize_encoding_and_timeout() {
    for (headers, body, kind) in [
        (
            "Content-Type: text/html\r\n",
            b"<html>".to_vec(),
            "unreadable",
        ),
        (
            "Content-Type: application/json\r\nContent-Encoding: gzip\r\n",
            b"[]".to_vec(),
            "unreadable",
        ),
        (
            "Content-Type: application/json\r\n",
            vec![b' '; MAX_BODY + 1],
            "oversize",
        ),
        (
            "Content-Type: application/json\r\n",
            b"[{".to_vec(),
            "unreadable",
        ),
        (
            "Content-Type: application/json\r\n",
            vec![255],
            "unreadable",
        ),
    ] {
        assert_eq!(
            request(&Server::new(http("200 OK", headers, &body), false), TOTAL)
                .unwrap_err()
                .kind,
            kind
        );
    }
    let server = Server::new(
        b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n"
            .iter()
            .copied()
            .chain(format!("{:x}\r\n", MAX_BODY + 1).bytes())
            .chain(vec![b' '; MAX_BODY + 1])
            .chain(b"\r\n0\r\n\r\n".iter().copied())
            .collect(),
        false,
    );
    assert_eq!(request(&server, TOTAL).unwrap_err().kind, "oversize");
    let server = Server::new(
        b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 8\r\n\r\n[".to_vec(),
        true,
    );
    assert_eq!(
        request(&server, Duration::from_millis(100))
            .unwrap_err()
            .kind,
        "timeout"
    );
    let server = Server::new(Vec::new(), true);
    assert_eq!(
        request(&server, Duration::from_millis(100))
            .unwrap_err()
            .kind,
        "timeout"
    );
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    let error = tauri::async_runtime::block_on(async {
        transport(&client(TOTAL).unwrap(), &address, "KZZZ", Product::Metar).await
    })
    .unwrap_err();
    assert_eq!(error.kind, "offline");
}
#[test]
fn weather_cancel_drops_pending_transport_and_never_publishes() {
    let server = Server::new(Vec::new(), true);
    let token = Arc::new(CancelToken::default());
    let cancel = token.clone();
    let requests = server.requests.clone();
    std::thread::spawn(move || {
        crate::test_wait::wait_for("weather request received", || {
            !requests.lock().unwrap().is_empty()
        });
        cancel.cancel();
    });
    let result = tauri::async_runtime::block_on(async {
        Cancellable::new(
            transport(&client(TOTAL).unwrap(), &server.url, "KZZZ", Product::Metar),
            token,
        )
        .await
    });
    assert!(result.is_err());
    assert_eq!(server.requests.lock().unwrap().len(), 1);
}

#[test]
fn weather_native_session_off_cancels_and_rejects_direct_invocation() {
    let token = Arc::new(CancelToken::default());
    {
        let mut s = state().lock().unwrap();
        *s = State {
            enabled: true,
            session: 42,
            active: Some(token.clone()),
            ..State::default()
        };
    }
    assert_eq!(weather_session(false), 43);
    assert!(token.is_cancelled());
    let result =
        tauri::async_runtime::block_on(get_airport_weather("KZZZ".into(), Product::Metar, 43));
    assert_eq!(result.unwrap_err().kind, "cancelled");
    let invalid =
        tauri::async_runtime::block_on(get_airport_weather("KZ1".into(), Product::Metar, 43));
    assert_eq!(invalid.unwrap_err().kind, "icao");
    *state().lock().unwrap() = State::default();
}
