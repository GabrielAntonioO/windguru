const JSONBIN_API_KEY = '$2a$10$AjMK/XksYd.Fw0phfT.B4ud0nuC1nyjt0ZBo52sJk/wnCU75zuC76';
const JSONBIN_BIN_ID  = '6a0ffb2bee5a733b12fde0eb';
const JSONBIN_URL     = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

const DEFAULT = {
  lat: 42.24,
  lon: -8.72,
  barrio: null,
  ciudad: 'Vigo',
  pais: 'España',
  precision: null,
  updated: null,
};

async function readState() {
  try {
    const r = await fetch(JSONBIN_URL + '/latest', {
      headers: { 'X-Master-Key': JSONBIN_API_KEY }
    });
    if (!r.ok) throw new Error(`JSONBin GET ${r.status}`);
    const data = await r.json();
    return data.record;
  } catch {
    return { ...DEFAULT };
  }
}

async function writeState(state) {
  const r = await fetch(JSONBIN_URL, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Master-Key': JSONBIN_API_KEY,
    },
    body: JSON.stringify(state),
  });
  if (!r.ok) throw new Error(`JSONBin PUT ${r.status}`);
}

async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=es`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'WindguruApp/1.0', 'Accept-Language': 'es' }
  });
  if (!r.ok) throw new Error(`Nominatim ${r.status}`);
  const data = await r.json();
  const a = data.address;
  const barrio = a.suburb || a.quarter || a.village || a.hamlet || null;
  const ciudad = a.city || a.town || a.county || a.municipality || 'Desconocido';
  const pais   = a.country || '';
  return { barrio, ciudad, pais };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const { lat, lon, precision } = req.query;

  // GET without coords → return stored state
  if (!lat || !lon) {
    const state = await readState();
    return res.status(200).json(state);
  }

  // POST with coords → reverse geocode and update
  try {
    const latN = parseFloat(lat);
    const lonN = parseFloat(lon);
    const { barrio, ciudad, pais } = await reverseGeocode(latN, lonN);

    const newState = {
      lat: latN,
      lon: lonN,
      barrio,
      ciudad,
      pais,
      precision: precision ? parseInt(precision) : null,
      updated: new Date().toISOString(),
    };

    await writeState(newState);
    return res.status(200).json(newState);

  } catch (e) {
    return res.status(500).json({ error: 'Error procesando ubicación', detalle: e.message });
  }
}
