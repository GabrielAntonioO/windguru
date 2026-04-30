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
      "&wind_speed_unit=kmh" +
      "&timezone=Europe%2FMadrid" +
      "&forecast_days=2";

    const r = await fetch(url);
    if (!r.ok) throw new Error(`Open-Meteo status ${r.status}`);

    const data = await r.json();
    const h = data.hourly;

    if (!h?.time) throw new Error("Respuesta inesperada de Open-Meteo");

    // Hora actual en zona de Vigo (Madrid)
    const ahora = new Date();
    const horaActual = ahora.getHours();
    
    // Encontrar el índice donde comienza la hora actual
    let startIdx = 0;
    for (let i = 0; i < h.time.length; i++) {
      const fecha = new Date(h.time[i]);
      if (fecha.getHours() === horaActual) {
        startIdx = i;
        break;
      }
    }

    const result = h.time
      .slice(startIdx, startIdx + 48)
      .map((t, i) => {
        const fecha = new Date(t);
        const viento = Math.round(h.wind_speed_10m?.[startIdx + i] ?? 0);
        
        // Intensidad de viento: suave, medio, fuerte, muy fuerte
        let intensidad = 'suave';
        if (viento >= 40) intensidad = 'muy_fuerte';
        else if (viento >= 30) intensidad = 'fuerte';
        else if (viento >= 20) intensidad = 'medio';
        
        return {
          timestamp: t,
          hora:      fecha.getHours(),
          dia:       fecha.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }),
          viento:    viento,
          intensidad: intensidad,
          rafagas:   Math.round(h.wind_gusts_10m?.[startIdx + i]      ?? 0),
          dir:       Math.round(h.wind_direction_10m?.[startIdx + i]  ?? 0),
          temp:      Math.round(h.temperature_2m?.[startIdx + i]      ?? 0),
          nub_baja:  Math.round(h.cloud_cover_low?.[startIdx + i]     ?? 0),
          nub_media: Math.round(h.cloud_cover_mid?.[startIdx + i]     ?? 0),
          nub_alta:  Math.round(h.cloud_cover_high?.[startIdx + i]    ?? 0),
          lluvia:    parseFloat((h.precipitation?.[startIdx + i]      ?? 0).toFixed(1)),
        };
      });

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
