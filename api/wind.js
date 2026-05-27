const JSONBIN_API_KEY = '$2a$10$AjMK/XksYd.Fw0phfT.B4ud0nuC1nyjt0ZBo52sJk/wnCU75zuC76';
const JSONBIN_BIN_ID  = '6a0ffb2bee5a733b12fde0eb';
const JSONBIN_URL     = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

const SERPAPI_KEY = process.env.SERPAPI_KEY; // Configurar en Vercel

const DEFAULT_LAT = 42.24;
const DEFAULT_LON = -8.72;

// ========== JSONBin (sin cambios) ==========
async function getLocationFromJsonBin() {
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

async function saveLocationToJsonBin(lat, lon, barrio, ciudad) {
  try {
    const state = { lat, lon, barrio, ciudad, updated: new Date().toISOString() };
    const r = await fetch(JSONBIN_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_API_KEY },
      body: JSON.stringify(state),
    });
    if (!r.ok) throw new Error(`JSONBin PUT ${r.status}`);
  } catch (e) {
    console.error('Error saving location:', e.message);
  }
}

// ========== Geocoding (sin cambios) ==========
async function getReverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=es`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'WindguruApp/1.0', 'Accept-Language': 'es' }
    });
    if (!r.ok) throw new Error();
    const data = await r.json();
    const a = data.address;
    const barrio = a.suburb || a.quarter || a.village || a.hamlet || null;
    const ciudad = a.city || a.town || a.county || a.municipality || 'Desconocido';
    return { barrio, ciudad };
  } catch {
    return { barrio: null, ciudad: 'Desconocido' };
  }
}

// ========== Contrails (sin cambios) ==========
function toRHi(RHw, T_C) {
  const ew = 6.1078 * Math.exp(17.269 * T_C / (T_C + 237.29));
  const ei = 6.1078 * Math.exp(21.875 * T_C / (T_C + 265.5));
  return (RHw / 100) * (ew / ei) * 100;
}

function contrailPct(T, RHw) {
  const RHi = toRHi(RHw, T);
  if (T > -40) return 0;
  const ts = T <= -50 ? 3 : T <= -45 ? 2 : 1;
  const rs = RHi >= 110 ? 4 : RHi >= 100 ? 3 : RHi >= 95 ? 2 : RHi >= 90 ? 1 : 0;
  const cpi = ts + rs;
  const map = [0, 15, 30, 50, 65, 80, 90, 100];
  return map[Math.min(cpi, 7)];
}

// ========== NUEVO: SerpAPI → código Windguru ==========
async function buscarCodigoWindguru(ciudad) {
  if (!SERPAPI_KEY) {
    console.error('SERPAPI_KEY no configurada');
    return null;
  }

  try {
    const query = `windguru ${ciudad}`;
    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${SERPAPI_KEY}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`SerpAPI status ${r.status}`);
    const data = await r.json();
    const resultados = data.organic_results;

    if (!resultados || resultados.length === 0) return null;

    for (const res of resultados) {
      if (res.link && res.link.includes('windguru.cz')) {
        const match = res.link.match(/windguru\.cz\/(?:station\/)?(\d+)/);
        if (match) {
          console.log(`🔍 Windguru code for "${ciudad}": ${match[1]}`);
          return match[1];
        }
      }
    }
    return null;
  } catch (e) {
    console.error('SerpAPI error:', e.message);
    return null;
  }
}

// ========== NUEVO: Scraping Windguru ==========
async function scrapeWindguru(codigo) {
  try {
    const url = `https://www.windguru.cz/${codigo}`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }
    });
    if (!r.ok) throw new Error(`Windguru status ${r.status}`);
    const html = await r.text();

    // Windguru mete los datos de previsión en un script JSON embebido
    // Buscamos el patrón: windguru.data.wind = {...}
    const windMatch = html.match(/windguru\.data\.wind\s*=\s*({[\s\S]*?});/);
    if (!windMatch) throw new Error('No se encontró windguru.data.wind');

    const windData = JSON.parse(windMatch[1]);

    // Extraemos forecast de todos los modelos, preferimos el primero (GFS 27km suele ser el default)
    const modelos = Object.keys(windData);
    if (modelos.length === 0) throw new Error('Sin modelos disponibles');

    const modelo = windData[modelos[0]]; // Primer modelo disponible
    const horas = modelo.hours || [];
    const windSpeed = modelo.wind_speed || [];
    const windGusts = modelo.wind_gust || [];

    // Convertir a mapa: timestamp → { viento, rafagas }
    const windMap = {};
    horas.forEach((ts, i) => {
      windMap[ts] = {
        viento: Math.round(windSpeed[i] || 0),
        rafagas: Math.round(windGusts[i] || 0),
      };
    });

    console.log(`📊 Windguru: ${horas.length} horas de previsión extraídas`);
    return windMap;

  } catch (e) {
    console.error('Scraping error:', e.message);
    return null;
  }
}

// ========== HANDLER PRINCIPAL ==========
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  try {
    // 1. Obtener coordenadas
    let lat, lon;
    if (req.query.lat && req.query.lon) {
      lat = parseFloat(req.query.lat);
      lon = parseFloat(req.query.lon);
    } else {
      const locData = await getLocationFromJsonBin();
      lat = locData.lat;
      lon = locData.lon;
    }

    // 2. Geocoding inverso
    const locInfo = await getReverseGeocode(lat, lon);
    const ciudad = locInfo.ciudad || 'Desconocido';

    // 3. Buscar código Windguru + scraping (en paralelo con Open-Meteo para no bloquear)
    const coords = `?latitude=${lat}&longitude=${lon}&timezone=Europe%2FMadrid&forecast_days=7`;

    const urlWeather =
      "https://api.open-meteo.com/v1/forecast" + coords +
      "&hourly=temperature_2m,cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation" +
      "&daily=sunrise,sunset" +
      "&models=ecmwf_ifs025";

    const urlContrail =
      "https://api.open-meteo.com/v1/forecast" + coords +
      "&hourly=temperature_200hPa,temperature_225hPa,temperature_275hPa" +
      ",relative_humidity_200hPa,relative_humidity_225hPa,relative_humidity_275hPa";

    // Lanzamos todo en paralelo
    const [rWeather, rContrail, codigoWindguru] = await Promise.all([
      fetch(urlWeather),
      fetch(urlContrail),
      buscarCodigoWindguru(ciudad),
    ]);

    if (!rWeather.ok) throw new Error(`Open-Meteo weather status ${rWeather.status}`);
    if (!rContrail.ok) throw new Error(`Open-Meteo contrail status ${rContrail.status}`);

    const dataWeather = await rWeather.json();
    const dataContrail = await rContrail.json();
    const daily = dataWeather.daily;
    const h = { ...dataWeather.hourly, ...dataContrail.hourly };

    if (!h?.time) throw new Error("Respuesta inesperada de Open-Meteo");

    // 4. Scraping Windguru (si tenemos código)
    let windMap = {};
    if (codigoWindguru) {
      windMap = await scrapeWindguru(codigoWindguru) || {};
    }

    // 5. Sunrise/sunset map
    const sunMap = {};
    if (daily?.time) {
      daily.time.forEach((date, i) => {
        sunMap[date] = {
          sunrise: daily.sunrise[i],
          sunset:  daily.sunset[i],
        };
      });
    }

    // 6. Construir resultado
    const nowLocal = new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' });
    const nowDate  = new Date(nowLocal).toDateString();
    const nowHour  = new Date(nowLocal).getHours();

    const result = h.time.map((t, i) => {
      const dateKey = t.slice(0, 10);
      const hora    = parseInt(t.slice(11, 13));

      // Intentar obtener viento de Windguru, si no, usar Open-Meteo
      const wgData = windMap[t] || null;

      return {
        timestamp: t,
        dateKey,
        hora,
        viento:    wgData ? wgData.viento  : Math.round(dataWeather.hourly.wind_speed_10m?.[i] ?? 0),
        rafagas:   wgData ? wgData.rafagas : Math.round(dataWeather.hourly.wind_gusts_10m?.[i] ?? 0),
        temp:      Math.round(dataWeather.hourly.temperature_2m?.[i] ?? 0),
        nub_baja:  Math.round(dataWeather.hourly.cloud_cover_low?.[i]  ?? 0),
        nub_media: Math.round(dataWeather.hourly.cloud_cover_mid?.[i]  ?? 0),
        nub_alta:  Math.round(dataWeather.hourly.cloud_cover_high?.[i] ?? 0),
        lluvia:    parseFloat((dataWeather.hourly.precipitation?.[i] ?? 0).toFixed(1)),
        sunrise:   sunMap[dateKey]?.sunrise ?? null,
        sunset:    sunMap[dateKey]?.sunset  ?? null,
        e12: contrailPct(h.temperature_200hPa?.[i] ?? 0, h.relative_humidity_200hPa?.[i] ?? 0),
        e11: contrailPct(h.temperature_225hPa?.[i] ?? 0, h.relative_humidity_225hPa?.[i] ?? 0),
        e10: contrailPct(h.temperature_275hPa?.[i] ?? 0, h.relative_humidity_275hPa?.[i] ?? 0),
      };
    });

    // Filtrar desde hora actual, 7 días
    const startIdx = result.findIndex(d => {
      const f = new Date(d.timestamp);
      return f.toDateString() === nowDate && d.hora >= nowHour;
    });

    const from = startIdx >= 0 ? startIdx : 0;
    const filtered = result.slice(from, from + 7 * 24);

    // Guardar ubicación para Apple Watch
    if (req.query.lat && req.query.lon) {
      await saveLocationToJsonBin(lat, lon, locInfo.barrio, locInfo.ciudad);
    }

    return res.status(200).json({
      location: {
        ciudad: locInfo.ciudad || 'Desconocido',
        barrio: locInfo.barrio || null,
      },
      data: filtered,
      fuente_viento: codigoWindguru ? 'windguru' : 'open-meteo',
    });

  } catch (e) {
    return res.status(500).json({ error: "No se pudieron obtener los datos", detalle: e.message });
  }
}
