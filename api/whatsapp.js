const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    )
  });
}

const db = admin.firestore();

// ── Normalizar número argentino a 10 dígitos ──────────────────────
function normalizarTel(raw) {
  // Twilio envía: "whatsapp:+5493446123456"
  let num = raw.replace('whatsapp:', '').replace(/\D/g, '');
  // Argentina: código de país 54, el 9 intermedio es de celular
  if (num.startsWith('549')) num = num.slice(3);   // quita 54 + 9
  else if (num.startsWith('54')) num = num.slice(2); // quita 54
  return num; // ej: "3446123456"
}

// ── Parser de mensajes de campo ───────────────────────────────────
function parsearMensaje(texto) {
  const txt = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const hoy = new Date();
  const fechaStr = hoy.toLocaleDateString('es-AR');
  const fecha    = hoy.toISOString().split('T')[0];

  // Nacimiento
  if (txt.match(/naci[oó]|nacimiento/) || (txt.includes('ternero') && txt.match(/naci|pari[oó]|naci/))) {
    const carMatch = texto.match(/[A-Za-z]{2}-?\d+/i);
    const madre    = carMatch ? carMatch[0].toUpperCase() : '';
    const sexo     = txt.includes('macho') ? 'macho' : txt.includes('hembra') ? 'hembra' : '';
    const nuevaCar = 'TERN-' + String(Date.now()).slice(-4);
    return {
      tipo: 'nacimiento',
      datos: { caravana: nuevaCar, madre, sexo, fecha },
      respuesta: `✅ *Nacimiento registrado*\n🐄 Ternero${sexo ? ' ' + sexo : ''}${madre ? ' · Madre: ' + madre : ''}\n📟 Caravana: ${nuevaCar}\n📅 ${fechaStr}`
    };
  }

  // Muerte / baja
  if (txt.match(/muri[oó]|muerte|muerto/) || (txt.includes('baja') && !txt.includes('trabajo'))) {
    const carMatch = texto.match(/[A-Za-z]{2}-?\d+/i);
    const caravana = carMatch ? carMatch[0].toUpperCase() : '';
    return {
      tipo: 'baja',
      datos: { caravana, motivo: 'muerte', fecha },
      respuesta: caravana
        ? `✅ *Baja registrada*\n💀 ${caravana} — marcada como muerta\n📅 ${fechaStr}`
        : `✅ *Baja registrada*\n⚠️ No detecté la caravana. Completá en la app.\n📅 ${fechaStr}`
    };
  }

  // Peso
  if (txt.match(/pes[ao]/) || txt.match(/\d+\s*kg/)) {
    const carMatch  = texto.match(/[A-Za-z]{2}-?\d+/i);
    const caravana  = carMatch ? carMatch[0].toUpperCase() : '';
    const pesoMatch = txt.match(/(\d+)\s*kg/);
    const peso      = pesoMatch ? parseInt(pesoMatch[1]) : 0;
    return {
      tipo: 'peso',
      datos: { caravana, peso, fecha },
      respuesta: (caravana && peso)
        ? `✅ *Peso registrado*\n⚖️ ${caravana} — ${peso} kg\n📅 ${fechaStr}`
        : `✅ *Peso registrado*\n⚠️ No pude detectar caravana/kg. Revisá en la app.\n📅 ${fechaStr}`
    };
  }

  // Preñez / tacto
  if (txt.match(/prena[do]|preñ|tacto/)) {
    const carMatch = texto.match(/[A-Za-z]{2}-?\d+/i);
    const caravana = carMatch ? carMatch[0].toUpperCase() : '';
    const resultado = (txt.includes('vacia') || txt.includes('vació') || txt.includes('vacía')) ? 'vacia' : 'prenada';
    return {
      tipo: 'tacto',
      datos: { caravana, resultado, fecha },
      respuesta: caravana
        ? `✅ *Tacto registrado*\n🐄 ${caravana} — ${resultado === 'prenada' ? 'Preñada ✓' : 'Vacía ✗'}\n📅 ${fechaStr}`
        : `✅ *Tacto registrado*\n📅 ${fechaStr}`
    };
  }

  // Sanidad
  if (txt.match(/ivermectin|aftosa|vacun|brucel|antipar|clostrid|curador|sanid/)) {
    const cantMatch = txt.match(/(\d+)\s*(?:animales?|vacas?|cabezas?|terneros?)/);
    const cant      = cantMatch ? parseInt(cantMatch[1]) : 0;
    const productoMatch = texto.match(/(?:apliqué|aplicamos|vacunamos? con|con)\s+(.+?)(?:\s+a\s|\s+en\s|$)/i);
    const producto  = productoMatch ? productoMatch[1].trim() : texto.slice(0, 40);
    return {
      tipo: 'sanidad',
      datos: { producto, cantidad: cant, fecha },
      respuesta: `✅ *Sanidad registrada*\n💉 ${producto}${cant ? ' · ' + cant + ' animales' : ''}\n📅 ${fechaStr}`
    };
  }

  // Lluvia
  if (txt.match(/llovi[oó]|lluvi|mm(?!\w)|milimetros?/)) {
    const mmMatch = txt.match(/(\d+)\s*(?:mm|milimetros?)/);
    const mm      = mmMatch ? parseInt(mmMatch[1]) : 0;
    return {
      tipo: 'lluvia',
      datos: { mm, fecha },
      respuesta: mm > 0
        ? `✅ *Lluvia registrada*\n🌧 ${mm} mm\n📅 ${fechaStr}`
        : `✅ *Lluvia registrada*\n🌧 Anotado. Actualizá el mm en la app si falta.\n📅 ${fechaStr}`
    };
  }

  // Potrero
  if (txt.match(/movi|traslad|potrero/)) {
    const potrMatch = texto.match(/potrero\s+(\w+)/i);
    const potrero   = potrMatch ? potrMatch[1] : '';
    return {
      tipo: 'potrero',
      datos: { potrero, texto, fecha },
      respuesta: `✅ *Movimiento registrado*\n🌾 ${potrero ? 'Animales → Potrero ' + potrero : texto}\n📅 ${fechaStr}`
    };
  }

  // Nota genérica
  return {
    tipo: 'nota',
    datos: { texto, fecha },
    respuesta: `📝 *Anotado*\n"${texto}"\n📅 ${fechaStr}\n\n_No reconocí el tipo. Revisalo en la app._`
  };
}

// ── Handler principal ─────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'text/xml');

  if (req.method !== 'POST') {
    return res.status(405).send('<Response><Message>Método no permitido.</Message></Response>');
  }

  const from = req.body?.From || '';
  const body = (req.body?.Body || '').trim();

  if (!from || !body) {
    return res.send('<Response><Message>Mensaje vacío.</Message></Response>');
  }

  const tel = normalizarTel(from);

  try {
    // Buscar trabajador por teléfono
    const snap = await db.collection('trabajadores_lookup')
      .where('telefono', '==', tel)
      .limit(1)
      .get();

    if (snap.empty) {
      return res.send(`<Response><Message>No estás registrado en AGROGESTOR.\n\nPedile al productor que te agregue en *Módulo → Trabajadores* con tu número de WhatsApp.</Message></Response>`);
    }

    const trabajador        = snap.docs[0].data();
    const { uid_productor, nombre } = trabajador;

    const { tipo, datos, respuesta } = parsearMensaje(body);

    // Guardar mensaje en Firestore del productor
    await db
      .collection('usuarios').doc(uid_productor)
      .collection('wa_mensajes')
      .add({
        texto:      body,
        de:         nombre,
        telefono:   tel,
        tipo,
        datos,
        respuesta,
        timestamp:  admin.firestore.FieldValue.serverTimestamp(),
        procesado:  false
      });

    return res.send(`<Response><Message>${respuesta}</Message></Response>`);

  } catch (err) {
    console.error('WA webhook error:', err);
    return res.send('<Response><Message>Error interno. Intentá de nuevo en unos segundos.</Message></Response>');
  }
};
