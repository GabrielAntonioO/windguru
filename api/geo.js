export default async function handler(req, res) {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: 'Faltan parámetros lat y lon' });
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=es`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'WindguruApp/1.0',
        'Accept-Language': 'es'
      }
    });

    if (!r.ok) throw new Error(`Nominatim status ${r.status}`);

    const data = await r.json();
    const a = data.address;
    const lugar = a.city || a.town || a.village || a.municipality || a.county || a.state || 'Desconocido';
    const pais  = a.country || '';

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ lugar, pais, display: data.display_name });

  } catch (e) {
    return res.status(500).json({ error: 'No se pudo obtener el lugar', detalle: e.message });
  }
}
