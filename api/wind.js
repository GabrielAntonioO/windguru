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

    // Build sunrise/sunset map keyed by "YYYY-MM-DD"
    const sunMap = {};
    if (daily?.time) {
      daily.time.forEach((date, i) => {
        sunMap[date] = {
          sunrise: daily.sunrise[i], // "YYYY-MM-DDTHH:MM"
          sunset:  daily.sunset[i],
        };
      });
    }

    // Current hour in Madrid
    const nowLocal = new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' });
    const nowDate  = new Date(nowLocal).toDateString();
    const nowHour  = new Date(nowLocal).getHours();

    const result = h.time.map((t, i) => {
      const dateKey = t.slice(0, 10);
      const hora    = parseInt(t.slice(11, 13));
      const viento  = Math.round(h.wind_speed_10m?.[i] ?? 0);

      return {
        timestamp: t,
        dateKey,               // "YYYY-MM-DD" — used in frontend to compute day-of-week
        hora,
        viento,
        rafagas:   Math.round(h.wind_gusts_10m?.[i]     ?? 0),
        temp:      Math.round(h.temperature_2m?.[i]     ?? 0),
        nub_baja:  Math.round(h.cloud_cover_low?.[i]    ?? 0),
        nub_media: Math.round(h.cloud_cover_mid?.[i]    ?? 0),
        nub_alta:  Math.round(h.cloud_cover_high?.[i]   ?? 0),
        lluvia:    parseFloat((h.precipitation?.[i]     ?? 0).toFixed(1)),
        sunrise:   sunMap[dateKey]?.sunrise ?? null,
        sunset:    sunMap[dateKey]?.sunset  ?? null,
      };
    });

    // Filter from current hour
    const startIdx = result.findIndex(d => {
      const f = new Date(d.timestamp);
      return f.toDateString() === nowDate && d.hora >= nowHour;
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
