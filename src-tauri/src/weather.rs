//! Optional, memory-only lesson context. No credentials, persistence or retries.
use crate::gemini_cancel::{CancelToken, Cancellable};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const MAX_BODY: usize = 256 * 1024;
const TOTAL: Duration = Duration::from_secs(15);
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Product {
    Metar,
    Taf,
}
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Failure {
    kind: &'static str,
    retry_after_ms: u64,
}
fn failure(kind: &'static str) -> Failure {
    Failure {
        kind,
        retry_after_ms: 0,
    }
}
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Report {
    station: String,
    name: Option<String>,
    raw: String,
    report_time: Option<i64>,
    valid_from: Option<i64>,
    valid_to: Option<i64>,
    unavailable: bool,
    conditions: Value,
    periods: Vec<Value>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Reply {
    report: Option<Report>,
    fetched_at: u64,
}
#[derive(Default)]
struct State {
    session: u64,
    enabled: bool,
    active: Option<Arc<CancelToken>>,
    last: Option<Instant>,
    products: HashMap<(String, Product), Instant>,
    pause: Option<Instant>,
    rate_count: u32,
}
static STATE: OnceLock<Mutex<State>> = OnceLock::new();
fn state() -> &'static Mutex<State> {
    STATE.get_or_init(Default::default)
}
fn wall_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub(crate) fn icao(input: &str) -> Result<String, Failure> {
    let value = input.trim().to_ascii_uppercase();
    if input.chars().any(char::is_control)
        || value.len() != 4
        || !value.bytes().all(|b| b.is_ascii_alphabetic())
    {
        return Err(failure("icao"));
    }
    Ok(value)
}
fn url(station: &str, product: Product) -> String {
    match product {
        Product::Metar => {
            format!("https://aviationweather.gov/api/data/metar?ids={station}&format=json&hours=2")
        }
        Product::Taf => {
            format!("https://aviationweather.gov/api/data/taf?ids={station}&format=json&time=valid")
        }
    }
}
#[tauri::command]
pub(crate) fn weather_session(enabled: bool) -> u64 {
    let mut s = state().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(token) = &s.active {
        token.cancel();
    }
    s.enabled = enabled;
    s.session += 1;
    s.session
}
impl State {
    fn begin(
        &mut self,
        station: &str,
        product: Product,
        session: u64,
        now: Instant,
    ) -> Result<Arc<CancelToken>, Failure> {
        if !self.enabled || self.session != session {
            return Err(failure("cancelled"));
        }
        if self.active.is_some() {
            return Err(failure("busy"));
        }
        self.products
            .retain(|_, at| now.duration_since(*at) < Duration::from_secs(60));
        let until = [
            self.pause,
            self.last.map(|t| t + Duration::from_secs(2)),
            self.products
                .get(&(station.to_owned(), product))
                .map(|t| *t + Duration::from_secs(60)),
        ]
        .into_iter()
        .flatten()
        .max();
        if let Some(until) = until.filter(|until| *until > now) {
            return Err(Failure {
                kind: "pause",
                retry_after_ms: (until - now).as_millis() as u64,
            });
        }
        let token = Arc::new(CancelToken::default());
        self.active = Some(token.clone());
        self.last = Some(now);
        self.products.insert((station.to_owned(), product), now);
        Ok(token)
    }
    fn finish(&mut self, result: &mut Result<Reply, Failure>, now: Instant) {
        if let Err(error) = result {
            if error.kind == "rate" {
                self.rate_count = self.rate_count.saturating_add(1);
                let backoff = (60_000u64
                    .saturating_mul(1u64 << self.rate_count.min(5).saturating_sub(1)))
                .min(900_000);
                error.retry_after_ms = error.retry_after_ms.max(backoff);
            }
            if matches!(error.kind, "rate" | "timeout" | "server") {
                error.retry_after_ms = error.retry_after_ms.max(30_000);
                // Even an excessive server delay must not overflow Instant.
                self.pause = now
                    .checked_add(Duration::from_millis(error.retry_after_ms))
                    .or_else(|| now.checked_add(Duration::from_secs(315_360_000)));
            }
        } else {
            self.rate_count = 0;
        }
    }
}
struct Active(Arc<CancelToken>);
impl Drop for Active {
    fn drop(&mut self) {
        let mut s = state().lock().unwrap_or_else(|e| e.into_inner());
        if s.active.as_ref().is_some_and(|t| Arc::ptr_eq(t, &self.0)) {
            s.active = None;
        }
    }
}
#[tauri::command]
pub(crate) async fn get_airport_weather(
    station: String,
    product: Product,
    session: u64,
) -> Result<Reply, Failure> {
    let station = icao(&station)?;
    let token = state().lock().unwrap_or_else(|e| e.into_inner()).begin(
        &station,
        product,
        session,
        Instant::now(),
    )?;
    let _active = Active(token.clone());
    let client = client(TOTAL)?;
    let address = url(&station, product);
    let work = transport(&client, &address, &station, product);
    let mut result = match Cancellable::new(tokio::time::timeout(TOTAL, work), token.clone()).await
    {
        Err(_) => Err(failure("cancelled")),
        Ok(Err(_)) => Err(failure("timeout")),
        Ok(Ok(result)) => result,
    };
    let mut s = state().lock().unwrap_or_else(|e| e.into_inner());
    if token.is_cancelled() || s.session != session || !s.enabled {
        return Err(failure("cancelled"));
    }
    s.finish(&mut result, Instant::now());
    result
}
fn client(total: Duration) -> Result<reqwest::Client, Failure> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(total)
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .no_proxy()
        .user_agent(concat!(
            "HerFlightDeck/",
            env!("CARGO_PKG_VERSION"),
            " (lesson-preparation-weather)"
        ))
        .build()
        .map_err(|_| failure("unavailable"))
}
fn network(error: reqwest::Error) -> Failure {
    failure(if error.is_timeout() {
        "timeout"
    } else if error.is_connect() {
        "offline"
    } else {
        "unavailable"
    })
}
async fn transport(
    client: &reqwest::Client,
    address: &str,
    station: &str,
    product: Product,
) -> Result<Reply, Failure> {
    let mut response = client
        .get(address)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(network)?;
    let status = response.status().as_u16();
    // Read no error body; upstream diagnostics may contain arbitrary data.
    if status == 429 {
        return Err(Failure {
            kind: "rate",
            retry_after_ms: crate::gemini_budget::retry_after(
                response
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok()),
            )
            .map_or(0, |d| d.as_millis().min(u64::MAX as u128) as u64),
        });
    }
    if status >= 500 {
        return Err(failure("server"));
    }
    if status == 204 {
        return Ok(Reply {
            report: None,
            fetched_at: wall_ms(),
        });
    }
    if status != 200 {
        return Err(failure("unavailable"));
    }
    let headers = response.headers();
    if headers
        .get("content-encoding")
        .is_some_and(|v| v != "identity")
    {
        return Err(failure("unreadable"));
    }
    if !headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.split(';')
                .next()
                .unwrap_or("")
                .trim()
                .eq_ignore_ascii_case("application/json")
        })
    {
        return Err(failure("unreadable"));
    }
    if response
        .content_length()
        .is_some_and(|n| n > MAX_BODY as u64)
    {
        return Err(failure("oversize"));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network)? {
        if body.len().saturating_add(chunk.len()) > MAX_BODY {
            return Err(failure("oversize"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(Reply {
        report: decode(&body, station, product, wall_ms() as i64)?,
        fetched_at: wall_ms(),
    })
}
// Only format known decoded fields. Never carry coordinates, category badges or arbitrary metadata to the view.
fn conditions(value: &Value) -> Value {
    let mut out = Map::new();
    for key in [
        "wdir", "wspd", "wgst", "visib", "clouds", "vertVis", "temp", "dewp", "altim",
    ] {
        if let Some(v) = value.get(key) {
            out.insert(key.into(), v.clone());
        }
    }
    Value::Object(out)
}
fn seconds(value: Option<&Value>) -> Option<i64> {
    value?
        .as_i64()
        .filter(|v| (0..=253_402_300_799).contains(v))
        .and_then(|v| v.checked_mul(1000))
}
fn issue(value: Option<&Value>) -> Option<i64> {
    let raw = value?.as_str()?;
    // AWC has also used a space before UTC time; require an explicit zone.
    let normalized = if raw.as_bytes().get(10) == Some(&b' ') {
        raw.replacen(' ', "T", 1)
    } else {
        raw.to_string()
    };
    let year: i32 = normalized.get(0..4)?.parse().ok()?;
    let month: usize = normalized.get(5..7)?.parse().ok()?;
    let day: u32 = normalized.get(8..10)?.parse().ok()?;
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max = *[
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ]
    .get(month.checked_sub(1)?)?;
    if day == 0 || day > max || !normalized.ends_with('Z') {
        return None;
    }
    crate::gemini_files::parse_rfc3339(&normalized)?
        .checked_mul(1000)
        .filter(|v| *v >= 0)
}
fn interval(value: &Value, from: &str, to: &str) -> Result<(i64, i64), Failure> {
    let start = seconds(value.get(from)).ok_or_else(|| failure("unreadable"))?;
    let end = seconds(value.get(to)).ok_or_else(|| failure("unreadable"))?;
    if start >= end {
        return Err(failure("unreadable"));
    }
    Ok((start, end))
}
fn raw_station(raw: &str) -> Option<&str> {
    raw.split_whitespace()
        .find(|s| !["METAR", "SPECI", "TAF", "AMD", "COR"].contains(s))
}
fn decode(
    body: &[u8],
    station: &str,
    product: Product,
    now: i64,
) -> Result<Option<Report>, Failure> {
    if body.len() > MAX_BODY {
        return Err(failure("oversize"));
    }
    let text = std::str::from_utf8(body).map_err(|_| failure("unreadable"))?;
    let value: Value = serde_json::from_str(text).map_err(|_| failure("unreadable"))?;
    let records = value
        .as_array()
        .filter(|v| v.len() <= 64)
        .ok_or_else(|| failure("unreadable"))?;
    let mut reports = Vec::new();
    for item in records {
        let raw = item
            .get(if product == Product::Metar {
                "rawOb"
            } else {
                "rawTAF"
            })
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty() && s.len() <= 16 * 1024)
            .ok_or_else(|| failure("unreadable"))?;
        if item.get("icaoId").and_then(Value::as_str) != Some(station)
            || raw_station(raw) != Some(station)
        {
            return Err(failure("mismatch"));
        }
        if raw
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\r' | '\n' | '\t'))
        {
            return Err(failure("unreadable"));
        }
        let unavailable = raw
            .split_whitespace()
            .any(|s| matches!(s.trim_end_matches('='), "NIL" | "CNL"));
        let report_time = if product == Product::Metar {
            seconds(item.get("obsTime"))
        } else {
            issue(item.get("issueTime"))
        };
        let mut report = Report {
            station: station.into(),
            name: item
                .get("name")
                .and_then(Value::as_str)
                .filter(|s| s.len() <= 512)
                .map(str::to_owned),
            raw: raw.into(),
            report_time,
            valid_from: None,
            valid_to: None,
            unavailable,
            conditions: conditions(item),
            periods: Vec::new(),
        };
        if product == Product::Taf && !unavailable {
            let (start, end) = interval(item, "validTimeFrom", "validTimeTo")?;
            report.valid_from = Some(start);
            report.valid_to = Some(end);
            if let Some(groups) = item.get("fcsts").filter(|v| !v.is_null()) {
                let groups = groups
                    .as_array()
                    .filter(|v| v.len() <= 64)
                    .ok_or_else(|| failure("unreadable"))?;
                for group in groups {
                    let (from, to) = interval(group, "timeFrom", "timeTo")?;
                    if from < start || to > end {
                        return Err(failure("unreadable"));
                    }
                    let mut period = conditions(group);
                    for key in ["fcstChange", "probability", "timeBec"] {
                        if let Some(v) = group.get(key) {
                            period[key] = v.clone();
                        }
                    }
                    period["from"] = from.into();
                    period["to"] = to.into();
                    report.periods.push(period);
                }
            }
        }
        reports.push(report);
    }
    // Newest issuance wins over an older TAF, including a cancellation. Prefer an
    // applicable forecast to one for a different validity window; preserve future/ended labels.
    reports.sort_by_key(|r| {
        (
            r.report_time.unwrap_or(i64::MIN),
            r.raw.contains(" AMD ") || r.raw.contains(" COR "),
            r.unavailable,
            r.raw.clone(),
        )
    });
    if product == Product::Taf {
        if let Some(newest) = reports.last() {
            if newest.unavailable {
                return Ok(reports.pop());
            }
        }
        if let Some(index) = reports.iter().rposition(|r| {
            r.valid_from.is_some_and(|v| v <= now) && r.valid_to.is_some_and(|v| now < v)
        }) {
            // A later cancellation also invalidates an older applicable report
            // when an even newer forecast is for a future window.
            let selected = reports
                .iter()
                .rposition(|r| r.unavailable)
                .filter(|cancelled| *cancelled > index)
                .unwrap_or(index);
            return Ok(Some(reports.remove(selected)));
        }
    }
    Ok(reports.pop())
}

#[cfg(test)]
#[path = "weather_tests.rs"]
mod tests;
