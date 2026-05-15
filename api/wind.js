let cache = null;
let cacheTime = 0;
const TTL = 10 * 60 * 1000;

export default async function handler(req, res) {
  const now = Date.now();

  if (cache && now - cacheTime < TTL) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json(cache);
  }

  try {
    // Vigo: 42.24°N, -8.72°E
    const url =
      "https://api.open-meteo.com/v1/forecast" +
      "?latitude=42.24&longitude=-8.72" +
      "&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m" +
      ",temperature_2m,cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation" +
      "&daily=sunrise,sunset" +
      "&wind_speed_unit=kmh" +
      "&timezone=Europe%2FMadrid" +
      "&forecast_days=2";

    const r = await fetch(url);
    if (!r.ok) throw new Error(`Open-Meteo status ${r.status}`);

    const data = await r.json();
    const h = data.hourly;
    const daily = data.daily;

    if (!h?.time) throw new Error("Respuesta inesperada de Open-Meteo");

    // Build sunrise/sunset map keyed by date string "YYYY-MM-DD"
    const sunMap = {};
    if (daily?.time) {
      daily.time.forEach((date, i) => {
        sunMap[date] = {
          sunrise: daily.sunrise[i], // "2025-05-15T07:05"
          sunset:  daily.sunset[i],  // "2025-05-15T20:59"
        };
      });
    }

    // Hora actual en Vigo
    const nowLocal = new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' });
    const nowHour  = new Date(nowLocal).getHours();
    const nowDate  = new Date(nowLocal).toDateString();

    const result = h.time.map((t, i) => {
      const fecha  = new Date(t);
      const viento = Math.round(h.wind_speed_10m?.[i] ?? 0);
      const dateKey = t.slice(0, 10); // "YYYY-MM-DD"

      let intensidad = 'suave';
      if (viento >= 40) intensidad = 'muy_fuerte';
      else if (viento >= 30) intensidad = 'fuerte';
      else if (viento >= 20) intensidad = 'medio';

      return {
        timestamp:  t,
        hora:       fecha.getHours(),
        dia:        fecha.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }),
        diaSemana:  fecha.getDay(), // 0=domingo
        viento,
        rafagas:    Math.round(h.wind_gusts_10m?.[i]      ?? 0),
        dir:        Math.round(h.wind_direction_10m?.[i]  ?? 0),
        temp:       Math.round(h.temperature_2m?.[i]      ?? 0),
        nub_baja:   Math.round(h.cloud_cover_low?.[i]     ?? 0),
        nub_media:  Math.round(h.cloud_cover_mid?.[i]     ?? 0),
        nub_alta:   Math.round(h.cloud_cover_high?.[i]    ?? 0),
        lluvia:     parseFloat((h.precipitation?.[i]      ?? 0).toFixed(1)),
        intensidad,
        sunrise:    sunMap[dateKey]?.sunrise ?? null, // "YYYY-MM-DDTHH:MM"
        sunset:     sunMap[dateKey]?.sunset  ?? null,
      };
    });

    // Filtrar desde la hora actual
    const startIdx = result.findIndex(d => {
      const f = new Date(d.timestamp);
      return f.toDateString() === nowDate && f.getHours() >= nowHour;
    });

    const filtered = result.slice(startIdx >= 0 ? startIdx : 0, (startIdx >= 0 ? startIdx : 0) + 48);

    cache = filtered;
    cacheTime = now;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json(filtered);

  } catch (e) {
    res.setHeader("Content-Type", "application/json");
    return res.status(500).json({ error: "No se pudieron obtener los datos", detalle: e.message });
  }
}
