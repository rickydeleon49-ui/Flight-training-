import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/data";
import { clockIsConsistent, normalizeIcao, type WeatherProduct, type WeatherReport } from "@/logic/weather";

export const WEATHER_PREFERENCE = "her-flight-deck.show-airport-weather";
export function storedWeatherPreference(): boolean {
  try { return localStorage.getItem(WEATHER_PREFERENCE) === "true"; } catch { return false; }
}
export interface WeatherFailure { kind: string; retryAfterMs?: number }
export interface WeatherReply { report: WeatherReport | null; fetchedAt: number }
export interface ProductView { report: WeatherReport | null; fetchedAt: number; previous: boolean; timeConfident: boolean; status: string; until: number }
export interface WeatherView {
  enabled: boolean; station: string; busy: WeatherProduct | null; metar: ProductView; taf: ProductView;
  until: number; now: number; mono: number; confident: boolean;
}
const emptyProduct = (): ProductView => ({ report: null, fetchedAt: 0, previous: false, timeConfident: true, status: "", until: 0 });
interface Dependencies {
  native: () => boolean; wall: () => number; mono: () => number;
  session: (enabled: boolean) => Promise<number>;
  get: (station: string, product: WeatherProduct, session: number) => Promise<WeatherReply>;
}
/** One selected station, one report per product; only the boolean preference touches storage. */
export class WeatherController {
  private listeners = new Set<() => void>();
  private revision = 0;
  private mounted = false;
  private session = Promise.resolve(0);
  private clock: [number, number];
  private value: WeatherView;
  constructor(private deps: Dependencies, enabled = false) {
    this.clock = [deps.wall(), deps.mono()];
    this.value = { enabled, station: "", busy: null, metar: emptyProduct(), taf: emptyProduct(), until: 0, now: this.clock[0], mono: this.clock[1], confident: true };
  }
  snapshot = (): WeatherView => this.value;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(patch: Partial<WeatherView>) { this.value = { ...this.value, ...patch }; this.listeners.forEach(fn => fn()); }
  tick = () => {
    const wall = this.deps.wall(), mono = this.deps.mono();
    const consistent = clockIsConsistent(wall, mono, ...this.clock);
    this.update({ now: wall, mono, confident: this.value.confident && consistent,
      ...(!consistent ? { metar: { ...this.value.metar, timeConfident: false }, taf: { ...this.value.taf, timeConfident: false } } : {}) });
    this.clock = [wall, mono];
  };
  private invalidate() {
    this.revision++;
    this.update({ busy: null });
    const enabled = this.mounted && this.value.enabled;
    // Serialize context changes so an old cleanup cannot cancel a newer view.
    if (this.deps.native()) this.session = this.session.catch(() => 0).then(() => this.deps.session(enabled));
    // Context failures remain unavailable and never become an unhandled rejection.
    void this.session.catch(() => {});
  }
  open = () => { this.mounted = true; this.tick(); this.invalidate(); return () => { this.mounted = false; this.invalidate(); }; };
  setEnabled = (enabled: boolean) => {
    try { localStorage.setItem(WEATHER_PREFERENCE, JSON.stringify(enabled)); } catch { /* session preference still applies */ }
    this.update({ enabled, ...(!enabled ? { station: "", metar: emptyProduct(), taf: emptyProduct() } : {}) });
    this.invalidate();
  };
  setStation = (station: string) => {
    this.update({ station, metar: emptyProduct(), taf: emptyProduct() }); this.invalidate();
  };
  clear = () => { this.update({ station: "", metar: emptyProduct(), taf: emptyProduct() }); this.invalidate(); };
  request = async (product: WeatherProduct): Promise<void> => {
    const v = this.value, station = normalizeIcao(v.station);
    if (!v.enabled || !this.mounted || !this.deps.native() || !station || v.busy || this.deps.mono() < Math.max(v.until, v[product].until)) return;
    const revision = this.revision;
    const started = this.deps.mono();
    this.update({ busy: product, until: started + 2000, [product]: { ...v[product], status: "Getting report…", until: started + 60_000 } });
    try {
      const session = await this.session;
      if (revision !== this.revision) return;
      const result = await this.deps.get(station, product, session);
      if (revision !== this.revision) return;
      // Reject malformed IPC data as well as any station confusion.
      if (result.report && result.report.station !== station) throw { kind: "mismatch" };
      this.tick();
      this.update({ confident: true, [product]: { ...this.value[product], report: result.report, fetchedAt: result.fetchedAt, previous: false, timeConfident: true,
        status: !result.report || result.report.unavailable ? (product === "metar" ? "No observation returned for this airport" : "No forecast returned for this airport.") : "" } });
    } catch (error) {
      if (revision !== this.revision) return;
      const kind = (error as WeatherFailure | null)?.kind;
      const retry = (error as WeatherFailure | null)?.retryAfterMs;
      const pause = typeof retry === "number" && Number.isFinite(retry) && retry > 0 ? retry : (kind === "timeout" || kind === "server" ? 30_000 : kind === "rate" ? 60_000 : 0);
      const status = kind === "offline" ? "Weather couldn't be reached. You may be offline." : kind === "rate" || kind === "pause" ? "The weather service needs a pause. Try again after" : "Weather couldn't be updated. Try again later.";
      this.update({ until: Math.max(this.value.until, this.deps.mono() + pause), [product]: { ...this.value[product], status, previous: !!this.value[product].report,
        ...(kind === "busy" || kind === "cancelled" || kind === "pause" ? { until: v[product].until } : {}) } });
    } finally { if (revision === this.revision) this.update({ busy: null }); }
  };
}
export const airportWeather = new WeatherController({
  native: isTauri, wall: Date.now, mono: () => performance.now(),
  session: enabled => invoke<number>("weather_session", { enabled }),
  get: (station, product, session) => invoke<WeatherReply>("get_airport_weather", { station, product, session }),
}, storedWeatherPreference());
