import { promises as fs } from 'fs';
import path from 'path';

const STATE_FILE = '/tmp/location.json';
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
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { ...DEFAULT };
  }
}

async function writeState(state) {
  await fs.writeFile(STATE_FILE, JSON.stringify(state), 'utf8');
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

  // POST with coords → reverse geocode and maybe update
  try {
    const latN = parseFloat(lat);
    const lonN = parseFloat(lon);
    const { barrio, ciudad, pais } = await reverseGeocode(latN, lonN);

    const current = await readState();

    // Always update coords and location
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
