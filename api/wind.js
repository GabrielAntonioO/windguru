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
      "https://www.windguru.cz/int/iapi.php?model=GFS&spot=1066&units_wind=kmh&units_temp=c";

    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        "Referer": "https://www.windguru.cz/",
        "Accept": "application/json",
      },
    });

    if (!r.ok) throw new Error(`Windguru status ${r.status}`);

    const data = await r.json();

    if (!data?.fcst?.hour) throw new Error("Respuesta inesperada de Windguru");

    const result = data.fcst.hour.map((h, i) => ({
      hora:      h,
      viento:    Math.round(data.fcst.wind_speed?.[i]   ?? 0),
      rafagas:   Math.round(data.fcst.gust?.[i]          ?? 0),
      dir:       data.fcst.wind_direction?.[i]            ?? null,
      temp:      Math.round(data.fcst.temp?.[i]           ?? 0),
      nub_baja:  data.fcst.cloud_low?.[i]                 ?? 0,
      nub_media: data.fcst.cloud_mid?.[i]                 ?? 0,
      nub_alta:  data.fcst.cloud_high?.[i]                ?? 0,
      lluvia:    parseFloat((data.fcst.rain?.[i] ?? 0).toFixed(1)),
    })).slice(0, 24);

    cache = result;
    cacheTime = now;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json(result);

  } catch (e) {
    res.setHeader("Content-Type", "application/json");
    return res.status(500).json({ error: "No se pudieron obtener los datos", detalle: e.message });
  }
}
