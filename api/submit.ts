import {
  readEnv, corsHeaders, getAccessToken, json, normalize,
  resolveSheetId, getNextTicket, uploadFileToDrive,
} from "./_google";

export const config = { runtime: "edge" };

/* ═══════════════════════════════════════════════════════════
   CABECERAS DE COLUMNAS — se agregaron Ticket, Proveedor,
   Llego_Certificado y Fotos_URLs a todas las hojas
═══════════════════════════════════════════════════════════ */
const RESP_HEADERS = [
  'Ticket','Response_ID','Timestamp','Tienda_ID','Tienda_Nombre','Fecha_Evento',
  'Nombre','Apellido','Tipo_Evento','Proveedor',
  'Tipo_Evento_Plaga','Tipo_Plaga','Sector_Hallazgo','Comentario_Plaga',
  'Dosif_inco_Aroma','Equip_malo_Aroma','Hurto_Equip_Aroma','Comentario_Aroma',
  'Falla_Dil_Quimico','Otra_Inci_Quimico','Problema_Ped_Quimico','Comentario_Quimicos',
  'Llego_Certificado','Fotos_URLs','Submitter_IP',
];

const HDR_PLAGA = [
  'Ticket','Response_ID','Timestamp','Tienda_ID','Tienda_Nombre','Fecha_Evento',
  'Nombre','Apellido','Proveedor','Llego_Certificado',
  'Tipo_Evento_Plaga','Tipo_Plaga','Sector_Hallazgo','Comentario_Plaga','Fotos_URLs',
];
const HDR_AROMA = [
  'Ticket','Response_ID','Timestamp','Tienda_ID','Tienda_Nombre','Fecha_Evento',
  'Nombre','Apellido','Proveedor',
  'Dosif_inco_Aroma','Equip_malo_Aroma','Hurto_Equip_Aroma','Comentario_Aroma','Fotos_URLs',
];
const HDR_QUIM = [
  'Ticket','Response_ID','Timestamp','Tienda_ID','Tienda_Nombre','Fecha_Evento',
  'Nombre','Apellido','Proveedor','Llego_Certificado',
  'Falla_Dil_Quimico','Otra_Inci_Quimico','Problema_Ped_Quimico','Comentario_Quimicos','Fotos_URLs',
];

/* ═══════════════════════════════════════════════════════════
   HELPERS GENERALES
═══════════════════════════════════════════════════════════ */
function csvToList(csv?: string): string[] {
  return String(csv || "").split(",").map(s => s.trim()).filter(Boolean);
}

function tipoNorm(raw?: string): 'plaga' | 'aroma' | 'quimico' | '' {
  const t = String(raw || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (t === 'plaga')   return 'plaga';
  if (t === 'aroma')   return 'aroma';
  if (t === 'quimico') return 'quimico';
  return '';
}

/* ═══════════════════════════════════════════════════════════
   TELEGRAM
═══════════════════════════════════════════════════════════ */
function buildTelegramMessage(row: Record<string, any>): string {
  const t = tipoNorm(row.Tipo_Evento);
  const fotos = row.Fotos_URLs ? `\n📷 <b>Fotos:</b> ${row.Fotos_URLs}` : '';
  const prov  = row.Proveedor  ? `\n🏢 <b>Proveedor:</b> ${row.Proveedor}` : '';

  const base =
`🎫 <b>Ticket:</b> ${row.Ticket}
🏪 <b>Tienda:</b> ${row.Tienda_Nombre}
📅 <b>Fecha:</b> ${row.Fecha_Evento}
🧑 <b>Reporta:</b> ${row.Nombre} ${row.Apellido}${prov}`;

  if (t === 'plaga') {
    const cert = row.Llego_Certificado ? `\n📋 <b>Llegó certificado:</b> ${row.Llego_Certificado}` : '';
    return (
`🚨 <b>Registro de Evento — PLAGA</b>\n\n${base}${cert}\n\n` +
`🌿 <b>Tipo de Plaga:</b> ${row.Tipo_Plaga}\n` +
`📍 <b>Sector:</b> ${row.Sector_Hallazgo}\n` +
`📌 <b>Tipo de Evento:</b> ${row.Tipo_Evento_Plaga}\n` +
`📝 <b>Comentario:</b> ${row.Comentario_Plaga}${fotos}`
    );
  }

  if (t === 'aroma') {
    const causa = row.Dosif_inco_Aroma  ? 'Dosificación incorrecta'
                : row.Equip_malo_Aroma  ? 'Equipo con fallas'
                : row.Hurto_Equip_Aroma ? 'Hurto de equipo'
                : '—';
    return (
`🚨 <b>Registro de Evento — AROMA</b>\n\n${base}\n\n` +
`⚠️ <b>Causa:</b> ${causa}\n` +
`📝 <b>Comentario:</b> ${row.Comentario_Aroma}${fotos}`
    );
  }

  // Químico
  const causaQ = row.Falla_Dil_Quimico    ? 'Falla en dilutor'
               : row.Otra_Inci_Quimico    ? 'Otra incidencia'
               : row.Problema_Ped_Quimico ? 'Problema en pedido'
               : '—';
  const cert = row.Llego_Certificado ? `\n📋 <b>Llegó certificado:</b> ${row.Llego_Certificado}` : '';
  return (
`🚨 <b>Registro de Evento — QUÍMICO</b>\n\n${base}${cert}\n\n` +
`⚠️ <b>Causa:</b> ${causaQ}\n` +
`📝 <b>Comentario:</b> ${row.Comentario_Quimicos}${fotos}`
  );
}

function chatIdsForType(tipo: ReturnType<typeof tipoNorm>, env: Record<string, string | undefined>): string[] {
  if (tipo === 'plaga')   return csvToList(env.TELEGRAM_CHAT_IDS_PLAGA);
  if (tipo === 'aroma')   return csvToList(env.TELEGRAM_CHAT_IDS_AROMA);
  if (tipo === 'quimico') return csvToList(env.TELEGRAM_CHAT_IDS_QUIMICO);
  return csvToList(env.TELEGRAM_CHAT_IDS_DEFAULT);
}

async function notifyTelegram(row: Record<string, any>, env: Record<string, string | undefined>): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const tipo  = tipoNorm(row.Tipo_Evento);
  const chats = chatIdsForType(tipo, env);
  if (!token || !chats.length) return;

  const url  = `https://api.telegram.org/bot${token}/sendMessage`;
  const text = buildTelegramMessage(row);

  await Promise.allSettled(
    chats.map(chat_id =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id, text, parse_mode: "HTML" }),
      })
    )
  );
}

/* ═══════════════════════════════════════════════════════════
   N8N WEBHOOK
═══════════════════════════════════════════════════════════ */
function webhookUrlForType(tipo: ReturnType<typeof tipoNorm>, env: Record<string, string | undefined>): string | undefined {
  if (tipo === 'plaga')   return env.N8N_WEBHOOK_PLAGA;
  if (tipo === 'aroma')   return env.N8N_WEBHOOK_AROMA;
  if (tipo === 'quimico') return env.N8N_WEBHOOK_QUIMICO;
  return undefined;
}

async function notifyN8N(row: Record<string, any>, env: Record<string, string | undefined>): Promise<void> {
  const tipo       = tipoNorm(row.Tipo_Evento);
  const webhookUrl = webhookUrlForType(tipo, env);
  if (!webhookUrl) return;

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      Ticket:        row.Ticket,
      Response_ID:   row.Response_ID,
      Timestamp:     row.Timestamp,
      Tienda_ID:     row.Tienda_ID,
      Tienda_Nombre: row.Tienda_Nombre,
      Fecha_Evento:  row.Fecha_Evento,
      Nombre:        row.Nombre,
      Apellido:      row.Apellido,
      Tipo_Evento:   row.Tipo_Evento,
      Proveedor:     row.Proveedor,
      Fotos_URLs:    row.Fotos_URLs,
      ...(tipo === 'plaga' && {
        Llego_Certificado: row.Llego_Certificado,
        Tipo_Evento_Plaga: row.Tipo_Evento_Plaga,
        Tipo_Plaga:        row.Tipo_Plaga,
        Sector_Hallazgo:   row.Sector_Hallazgo,
        Comentario:        row.Comentario_Plaga,
      }),
      ...(tipo === 'aroma' && {
        Dosif_inco_Aroma:  row.Dosif_inco_Aroma,
        Equip_malo_Aroma:  row.Equip_malo_Aroma,
        Hurto_Equip_Aroma: row.Hurto_Equip_Aroma,
        Comentario:        row.Comentario_Aroma,
      }),
      ...(tipo === 'quimico' && {
        Llego_Certificado:    row.Llego_Certificado,
        Falla_Dil_Quimico:    row.Falla_Dil_Quimico,
        Otra_Inci_Quimico:    row.Otra_Inci_Quimico,
        Problema_Ped_Quimico: row.Problema_Ped_Quimico,
        Comentario:           row.Comentario_Quimicos,
      }),
    }),
  }).catch(() => {/* fallo silencioso */});
}

/* ═══════════════════════════════════════════════════════════
   HANDLER PRINCIPAL
   Body esperado (multipart no aplica en Edge; se envía JSON
   con las fotos en base64 dentro del array "fotos"):
   {
     ...campos del formulario...,
     fotos: [{ base64: "data:image/jpeg;base64,...", name: "foto1.jpg", type: "image/jpeg" }]
   }
═══════════════════════════════════════════════════════════ */
export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Método no permitido" }, 405, req);
  }

  try {
    const body = await req.json();

    // Validar campos obligatorios
    const oblig = ["Tienda_Nombre", "Fecha_Evento", "Nombre", "Apellido", "Tipo_Evento"];
    for (const k of oblig) {
      if (!String(body[k] || "").trim()) return json({ ok: false, error: `Falta ${k}` }, 400, req);
    }

    const env    = readEnv();
    const rawEnv = (globalThis as any).process?.env || {};
    const token  = await getAccessToken(env);
    const id     = resolveSheetId(env.GOOGLE_SHEETS_ID);

    const SHEET_TND  = env.SHEET_TND  || "Tiendas";
    const SHEET_RESP = env.SHEET_RESP || "Respuestas";

    // ── 1. Buscar Tienda_ID ──
    const tiendasRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`${SHEET_TND}!A2:B`)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!tiendasRes.ok) throw new Error(`Tiendas error: ${await tiendasRes.text()}`);
    const tiendasJson = await tiendasRes.json();
    const target = normalize(body.Tienda_Nombre);
    let tiendaId = ""; let matches = 0;
    for (const r of (tiendasJson.values || [])) {
      if (normalize(String(r[1] || "")) === target) { tiendaId = String(r[0] || ""); matches++; }
    }
    let warn = "";
    if (matches === 0) warn = "No se encontró la tienda por nombre.";
    if (matches > 1)   warn = "Hay múltiples filas con el mismo Nombre_local.";

    // ── 2. Ticket secuencial ──
    const tipo       = tipoNorm(body.Tipo_Evento);
    const ticket     = tipo ? await getNextTicket(token, id, tipo) : 'N/A';
    const responseId = crypto.randomUUID();
    const tsISO      = new Date().toISOString();

    // ── 3. Subir fotos a Google Drive (opcional) ──
    let fotosURLs = '';
    const fotos: Array<{ base64: string; name: string; type: string }> = Array.isArray(body.fotos) ? body.fotos : [];
    if (fotos.length > 0 && token) {
      const uploadedUrls: string[] = [];
      for (const foto of fotos) {
        try {
          const url = await uploadFileToDrive(token, {
            base64:   foto.base64,
            mimeType: foto.type || 'image/jpeg',
            filename: `${ticket}_${foto.name || 'foto.jpg'}`,
            folderId: env.GOOGLE_DRIVE_FOLDER_ID,
          });
          uploadedUrls.push(url);
        } catch (e) {
          // Si falla una foto, continúa con las demás
          console.error('Error subiendo foto:', e);
        }
      }
      fotosURLs = uploadedUrls.join(' | ');
    }

    // ── 4. Construir objeto de fila ──
    const rowObj: Record<string, any> = {
      Ticket:        ticket,
      Response_ID:   responseId,
      Timestamp:     tsISO,
      Tienda_ID:     tiendaId,
      Tienda_Nombre: body.Tienda_Nombre     || '',
      Fecha_Evento:  body.Fecha_Evento      || '',
      Nombre:        body.Nombre            || '',
      Apellido:      body.Apellido          || '',
      Tipo_Evento:   body.Tipo_Evento       || '',
      Proveedor:     body.Proveedor         || '',
      // Plaga
      Tipo_Evento_Plaga: body.Tipo_Evento_Plaga || '',
      Tipo_Plaga:        body.Tipo_Plaga        || '',
      Sector_Hallazgo:   body.Sector_Hallazgo   || '',
      Comentario_Plaga:  body.Comentario_Plaga  || '',
      // Aroma
      Dosif_inco_Aroma:  body.Dosif_inco_Aroma  || '',
      Equip_malo_Aroma:  body.Equip_malo_Aroma  || '',
      Hurto_Equip_Aroma: body.Hurto_Equip_Aroma || '',
      Comentario_Aroma:  body.Comentario_Aroma  || '',
      // Químico
      Falla_Dil_Quimico:    body.Falla_Dil_Quimico    || '',
      Otra_Inci_Quimico:    body.Otra_Inci_Quimico     || '',
      Problema_Ped_Quimico: body.Problema_Ped_Quimico  || '',
      Comentario_Quimicos:  body.Comentario_Quimico    || '',
      // Comunes nuevos
      Llego_Certificado: body.Llego_Certificado || '',
      Fotos_URLs:        fotosURLs,
      Submitter_IP:      '',
    };

    // ── 5. Guardar en Sheets ──
    await appendValues(token, id, `${SHEET_RESP}!A:Y`, [[...RESP_HEADERS.map(h => rowObj[h])]]);

    const tipoRaw = String(body.Tipo_Evento || '');
    if (tipoRaw === 'Plaga') {
      await appendValues(token, id, `Respuestas_Plaga!A:O`,   [[...HDR_PLAGA.map(h => rowObj[h])]]);
    } else if (tipoRaw === 'Aroma') {
      await appendValues(token, id, `Respuestas_Aroma!A:N`,   [[...HDR_AROMA.map(h => rowObj[h])]]);
    } else if (tipoRaw === 'Químico' || tipoRaw === 'Quimico') {
      await appendValues(token, id, `Respuestas_Quimico!A:O`, [[...HDR_QUIM.map(h => rowObj[h])]]);
    }

    // ── 6. Notificaciones paralelas (fallos silenciosos) ──
    await Promise.allSettled([
      notifyTelegram(rowObj, rawEnv),
      notifyN8N(rowObj, rawEnv),
    ]);

    return json({ ok: true, Ticket: ticket, Response_ID: responseId, Tienda_ID: tiendaId, warn }, 200, req);
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "Error interno" }, 500, req);
  }
}

async function appendValues(token: string, sheetId: string, range: string, values: any[][]) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
  if (!r.ok) throw new Error(`Sheets append error: ${await r.text()}`);
}
