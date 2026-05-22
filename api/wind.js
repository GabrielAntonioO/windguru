const JSONBIN_API_KEY = '$2a$10$AjMK/XksYd.Fw0phfT.B4ud0nuC1nyjt0ZBo52sJk/wnCU75zuC76';
const JSONBIN_BIN_ID  = '6a0ffb2bee5a733b12fde0eb';
const JSONBIN_URL     = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

const DEFAULT_LAT = 42.24;
const DEFAULT_LON = -8.72;

let cache = null;
let cacheTime = 0;
const TTL = 10 * 60 * 1000;

async function getLocation() {
  try {
    const r = await fetch(JSONBIN_URL + '/latest', {
      headers: { 'X-Master-Key': JSONBIN_API_KEY }
    });
    if (!r.ok) throw new Error(`JSONBin ${r.status}`);
    const data = await r.json();
    const rec = data.record;
    if (rec?.lat && rec?.lon) return { lat: rec.lat, lon: rec.lon };
  } catch {}
  return { lat: DEFAULT_LAT, lon: DEFAULT_LON };
}

// Convert RH over water → RHi (over ice) using Magnus formula
function toRHi(RHw, T_C) {
  const ew = 6.1078 * Math.exp(17.269 * T_C / (T_C + 237.29));
  const ei = 6.1078 * Math.exp(21.875 * T_C / (T_C + 265.5));
  return (RHw / 100) * (ew / ei) * 100;
}

// CPI → percentage (Schumann 1996, 95% threshold for ERA5 dry bias)
function contrailPct(T, RHw) {
  const RHi = toRHi(RHw, T);
  if (T > -40) return 0;
  const ts = T <= -50 ? 3 : T <= -45 ? 2 : 1;
  const rs = RHi >= 110 ? 4 : RHi >= 100 ? 3 : RHi >= 95 ? 2 : RHi >= 90 ? 1 : 0;
  const cpi = ts + rs;
  const map = [0, 15, 30, 50, 65, 80, 90, 100];
  return map[Math.min(cpi, 7)];
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  const now = Date.now();

  if (cache && now - cacheTime < TTL) {
    return res.status(200).json(cache);
  }

  try {
    const { lat, lon } = await getLocation();

    const url =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${lat}&longitude=${lon}` +
      "&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m" +
      ",temperature_2m,cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation" +
      ",temperature_200hPa,temperature_225hPa,temperature_275hPa" +
      ",relative_humidity_200hPa,relative_humidity_225hPa,relative_humidity_275hPa" +
      "&daily=sunrise,sunset" +
      "&wind_speed_unit=kmh" +
      "&timezone=Europe%2FMadrid" +
      "&forecast_days=7";

    const r = await fetch(url);
    if (!r.ok) throw new Error(`Open-Meteo status ${r.status}`);

    const data = await r.json();
    const h = data.hourly;
    const daily = data.daily;

    if (!h?.time) throw new Error("Respuesta inesperada de Open-Meteo");

    // Sunrise/sunset map
    const sunMap = {};
    if (daily?.time) {
      daily.time.forEach((date, i) => {
        sunMap[date] = {
          sunrise: daily.sunrise[i],
          sunset:  daily.sunset[i],
        };
      });
    }

    const nowLocal = new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' });
    const nowDate  = new Date(nowLocal).toDateString();
    const nowHour  = new Date(nowLocal).getHours();

    const result = h.time.map((t, i) => {
      const dateKey = t.slice(0, 10);
      const hora    = parseInt(t.slice(11, 13));

      return {
        timestamp: t,
        dateKey,
        hora,
        viento:    Math.round(h.wind_speed_10m?.[i]       ?? 0),
        rafagas:   Math.round(h.wind_gusts_10m?.[i]       ?? 0),
        temp:      Math.round(h.temperature_2m?.[i]       ?? 0),
        nub_baja:  Math.round(h.cloud_cover_low?.[i]      ?? 0),
        nub_media: Math.round(h.cloud_cover_mid?.[i]      ?? 0),
        nub_alta:  Math.round(h.cloud_cover_high?.[i]     ?? 0),
        lluvia:    parseFloat((h.precipitation?.[i]       ?? 0).toFixed(1)),
        sunrise:   sunMap[dateKey]?.sunrise ?? null,
        sunset:    sunMap[dateKey]?.sunset  ?? null,
        e12: contrailPct(h.temperature_200hPa?.[i]  ?? 0, h.relative_humidity_200hPa?.[i]  ?? 0),
        e11: contrailPct(h.temperature_225hPa?.[i]  ?? 0, h.relative_humidity_225hPa?.[i]  ?? 0),
        e10: contrailPct(h.temperature_275hPa?.[i]  ?? 0, h.relative_humidity_275hPa?.[i]  ?? 0),
      };
    });

    // Filter from current hour, show 7 days
    const startIdx = result.findIndex(d => {
      const f = new Date(d.timestamp);
      return f.toDateString() === nowDate && d.hora >= nowHour;
    });

    const from = startIdx >= 0 ? startIdx : 0;
    const filtered = result.slice(from, from + 7 * 24);

    cache = filtered;
    cacheTime = now;

    // Include location metadata for the title
    const { lat: rLat, lon: rLon } = await getLocation();
    // Re-read full location info for title
    let locInfo = { ciudad: 'Vigo', barrio: null };
    try {
      const lr = await fetch(JSONBIN_URL + '/latest', { headers: { 'X-Master-Key': JSONBIN_API_KEY } });
      if (lr.ok) { const ld = await lr.json(); locInfo = ld.record; }
    } catch {}

    const response = {
      location: {
        ciudad: locInfo.ciudad || 'Vigo',
        barrio: locInfo.barrio || null,
      },
      data: filtered
    };

    return res.status(200).json(response);

  } catch (e) {
    return res.status(500).json({ error: "No se pudieron obtener los datos", detalle: e.message });
  }
}
