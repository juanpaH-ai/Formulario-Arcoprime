import { google } from "googleapis";
import Busboy from "busboy";
import { Readable } from "stream";

export const config = { api: { bodyParser: false } };

/* ── Cabeceras de columnas ─────────────────────────────────── */
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

/* ── Auth ──────────────────────────────────────────────────── */
function getAuth() {
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "";
  if (raw.includes("\\n")) raw = raw.replace(/\\n/g, "\n");
  let privateKey = raw;
  let clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  if (raw.trim().startsWith("{")) {
    const obj = JSON.parse(raw);
    privateKey = obj.private_key;
    clientEmail = obj.client_email || clientEmail;
  }
  return new google.auth.GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });
}

/* ── Subir archivo a Drive ─────────────────────────────────── */
async function uploadFileToDrive(auth, buffer, mimeType, fileName, folderId) {
  const drive = google.drive({ version: "v3", auth });
  const ts    = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const name  = `${ts}_${fileName}`;
  const meta  = { name };
  if (folderId) meta.parents = [folderId];

  const res = await drive.files.create({
    requestBody: meta,
    media: { mimeType, body: Readable.from(buffer) },
    fields: "id,webViewLink",
  });
  await drive.permissions.create({
    fileId: res.data.id,
    requestBody: { role: "reader", type: "anyone" },
  });
  return res.data.webViewLink;
}

/* ── Helpers ───────────────────────────────────────────────── */
function tipoNorm(raw) {
  const t = String(raw || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (t === "plaga")   return "plaga";
  if (t === "aroma")   return "aroma";
  if (t === "quimico") return "quimico";
  return "";
}

function normalize(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

function setCors(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

/* ── Telegram ──────────────────────────────────────────────── */
function buildTelegramMessage(row) {
  const t     = tipoNorm(row.Tipo_Evento);
  const fotos = row.Fotos_URLs ? `\n📷 <b>Fotos:</b> ${row.Fotos_URLs}` : "";
  const prov  = row.Proveedor  ? `\n🏢 <b>Proveedor:</b> ${row.Proveedor}` : "";
  const base  =
`🎫 <b>Ticket:</b> ${row.Ticket}
🏪 <b>Tienda:</b> ${row.Tienda_Nombre}
📅 <b>Fecha:</b> ${row.Fecha_Evento}
🧑 <b>Reporta:</b> ${row.Nombre} ${row.Apellido}${prov}`;

  if (t === "plaga") {
    const cert = row.Llego_Certificado ? `\n📋 <b>Llegó certificado:</b> ${row.Llego_Certificado}` : "";
    return `🚨 <b>Registro de Evento — PLAGA</b>\n\n${base}${cert}\n\n` +
      `🌿 <b>Tipo de Plaga:</b> ${row.Tipo_Plaga}\n` +
      `📍 <b>Sector:</b> ${row.Sector_Hallazgo}\n` +
      `📌 <b>Tipo de Evento:</b> ${row.Tipo_Evento_Plaga}\n` +
      `📝 <b>Comentario:</b> ${row.Comentario_Plaga}${fotos}`;
  }
  if (t === "aroma") {
    const causa = row.Dosif_inco_Aroma === "Sí" ? "Dosificación incorrecta"
                : row.Equip_malo_Aroma  === "Sí" ? "Equipo con fallas"
                : row.Hurto_Equip_Aroma === "Sí" ? "Hurto de equipo" : "—";
    return `🚨 <b>Registro de Evento — AROMA</b>\n\n${base}\n\n` +
      `⚠️ <b>Causa:</b> ${causa}\n📝 <b>Comentario:</b> ${row.Comentario_Aroma}${fotos}`;
  }
  const causaQ = row.Falla_Dil_Quimico    === "Sí" ? "Falla en dilutor"
               : row.Otra_Inci_Quimico    === "Sí" ? "Otra incidencia"
               : row.Problema_Ped_Quimico === "Sí" ? "Problema en pedido" : "—";
  const cert = row.Llego_Certificado ? `\n📋 <b>Llegó certificado:</b> ${row.Llego_Certificado}` : "";
  return `🚨 <b>Registro de Evento — QUÍMICO</b>\n\n${base}${cert}\n\n` +
    `⚠️ <b>Causa:</b> ${causaQ}\n📝 <b>Comentario:</b> ${row.Comentario_Quimicos}${fotos}`;
}

async function notifyTelegram(row) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const tipo  = tipoNorm(row.Tipo_Evento);
  const chatMap = {
    plaga:   process.env.TELEGRAM_CHAT_IDS_PLAGA,
    aroma:   process.env.TELEGRAM_CHAT_IDS_AROMA,
    quimico: process.env.TELEGRAM_CHAT_IDS_QUIMICO,
  };
  const chats = String(chatMap[tipo] || process.env.TELEGRAM_CHAT_IDS_DEFAULT || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  if (!token || !chats.length) return;

  const text = buildTelegramMessage(row);
  await Promise.allSettled(
    chats.map(chat_id =>
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id, text, parse_mode: "HTML" }),
      })
    )
  );
}

/* ── n8n ───────────────────────────────────────────────────── */
async function notifyN8N(row) {
  const tipo = tipoNorm(row.Tipo_Evento);
  const webhookMap = {
    plaga:   process.env.N8N_WEBHOOK_PLAGA,
    aroma:   process.env.N8N_WEBHOOK_AROMA,
    quimico: process.env.N8N_WEBHOOK_QUIMICO,
  };
  const url = webhookMap[tipo];
  if (!url) return;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      Ticket: row.Ticket, Response_ID: row.Response_ID, Timestamp: row.Timestamp,
      Tienda_ID: row.Tienda_ID, Tienda_Nombre: row.Tienda_Nombre,
      Fecha_Evento: row.Fecha_Evento, Nombre: row.Nombre, Apellido: row.Apellido,
      Tipo_Evento: row.Tipo_Evento, Proveedor: row.Proveedor, Fotos_URLs: row.Fotos_URLs,
      ...(tipo === "plaga"   && { Llego_Certificado: row.Llego_Certificado, Tipo_Evento_Plaga: row.Tipo_Evento_Plaga, Tipo_Plaga: row.Tipo_Plaga, Sector_Hallazgo: row.Sector_Hallazgo, Comentario: row.Comentario_Plaga }),
      ...(tipo === "aroma"   && { Dosif_inco_Aroma: row.Dosif_inco_Aroma, Equip_malo_Aroma: row.Equip_malo_Aroma, Hurto_Equip_Aroma: row.Hurto_Equip_Aroma, Comentario: row.Comentario_Aroma }),
      ...(tipo === "quimico" && { Llego_Certificado: row.Llego_Certificado, Falla_Dil_Quimico: row.Falla_Dil_Quimico, Otra_Inci_Quimico: row.Otra_Inci_Quimico, Problema_Ped_Quimico: row.Problema_Ped_Quimico, Comentario: row.Comentario_Quimicos }),
    }),
  }).catch(() => {});
}

/* ── Ticket secuencial ─────────────────────────────────────── */
async function getNextTicket(sheetsClient, sheetId, tipo) {
  const prefixMap = { plaga: "P", aroma: "A", quimico: "Q" };
  const sheetMap  = { plaga: "Respuestas_Plaga", aroma: "Respuestas_Aroma", quimico: "Respuestas_Quimico" };
  try {
    const res  = await sheetsClient.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${sheetMap[tipo]}!A:A` });
    const rows = (res.data.values || []).length;
    return `${prefixMap[tipo]}${Math.max(1, rows)}`;
  } catch {
    return `${prefixMap[tipo]}1`;
  }
}

/* ── Handler principal ─────────────────────────────────────── */
export default async function handler(req, res) {
  const origin = req.headers.origin || "*";
  setCors(res, origin);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(405).json({ ok: false, error: "Método no permitido" });

  try {
    // Parsear multipart con Busboy
    const fields = {};
    const files  = {};

    await new Promise((resolve, reject) => {
      const bb = Busboy({ headers: req.headers });
      bb.on("field", (name, val) => { fields[name] = val; });
      bb.on("file",  (name, stream, info) => {
        const chunks = [];
        stream.on("data", d => chunks.push(d));
        stream.on("end",  () => {
          files[name] = { buffer: Buffer.concat(chunks), mimeType: info.mimeType || "image/jpeg", fileName: info.filename || `${name}.jpg` };
        });
      });
      bb.on("close", resolve);
      bb.on("error", reject);
      req.pipe(bb);
    });

    // Validar obligatorios
    for (const k of ["Tienda_Nombre","Fecha_Evento","Nombre","Apellido","Tipo_Evento"]) {
      if (!String(fields[k] || "").trim()) return res.status(400).json({ ok: false, error: `Falta ${k}` });
    }

    const auth   = getAuth();
    const rawId  = process.env.GOOGLE_SHEETS_ID || "";
    const sheetId = rawId.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1] || rawId;
    const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

    const sheetsClient = google.sheets({ version: "v4", auth });
    const SHEET_TND  = process.env.SHEET_TND  || "Tiendas";
    const SHEET_RESP = process.env.SHEET_RESP || "Respuestas";

    // Buscar Tienda_ID
    const tRes = await sheetsClient.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${SHEET_TND}!A2:B` });
    const target = normalize(fields.Tienda_Nombre);
    let tiendaId = ""; let matches = 0;
    for (const r of (tRes.data.values || [])) {
      if (normalize(String(r[1] || "")) === target) { tiendaId = String(r[0] || ""); matches++; }
    }
    const warn = matches === 0 ? "No se encontró la tienda." : matches > 1 ? "Múltiples filas con ese nombre." : "";

    // Ticket
    const tipo   = tipoNorm(fields.Tipo_Evento);
    const ticket = tipo ? await getNextTicket(sheetsClient, sheetId, tipo) : "N/A";
    const tsISO  = new Date().toISOString();
    const responseId = require("crypto").randomUUID();

    // Subir fotos
    let fotosURLs = "";
    const fotoKeys = Object.keys(files).filter(k => k.startsWith("foto"));
    if (fotoKeys.length > 0) {
      const urls = [];
      for (const key of fotoKeys) {
        try {
          const f   = files[key];
          const url = await uploadFileToDrive(auth, f.buffer, f.mimeType, `${ticket}_${f.fileName}`, FOLDER_ID);
          urls.push(url);
        } catch (e) { console.error(`Error subiendo foto ${key}:`, e.message); }
      }
      fotosURLs = urls.join(" | ");
    }

    // Mapear categoría Aroma → campos booleanos
    const aromaCat = fields.aromaCat || "";
    const quimCat  = fields.quimCat  || "";

    const rowObj = {
      Ticket:        ticket,
      Response_ID:   responseId,
      Timestamp:     tsISO,
      Tienda_ID:     tiendaId,
      Tienda_Nombre: fields.Tienda_Nombre || "",
      Fecha_Evento:  fields.Fecha_Evento  || "",
      Nombre:        fields.Nombre        || "",
      Apellido:      fields.Apellido      || "",
      Tipo_Evento:   fields.Tipo_Evento   || "",
      Proveedor:     fields.Proveedor     || "",
      // Plaga
      Tipo_Evento_Plaga: fields.Tipo_Evento_Plaga || "",
      Tipo_Plaga:        fields.Tipo_Plaga        || "",
      Sector_Hallazgo:   fields.Sector_Hallazgo   || "",
      Comentario_Plaga:  fields.Comentario_Plaga  || "",
      // Aroma — mapeado desde aromaCat
      Dosif_inco_Aroma:  aromaCat === "Dosificación incorrecta" ? "Sí" : "",
      Equip_malo_Aroma:  aromaCat === "Equipo con fallas"       ? "Sí" : "",
      Hurto_Equip_Aroma: aromaCat === "Hurto de equipo"         ? "Sí" : "",
      Comentario_Aroma:  fields.Comentario_Aroma  || "",
      // Químico — mapeado desde quimCat
      Falla_Dil_Quimico:    quimCat === "Falla en dilutor"   ? "Sí" : "",
      Otra_Inci_Quimico:    quimCat === "Otra incidencia"    ? "Sí" : "",
      Problema_Ped_Quimico: quimCat === "Problema en pedido" ? "Sí" : "",
      Comentario_Quimicos:  fields.Comentario_Quimico || "",
      // Comunes
      Llego_Certificado: fields.Llego_Certificado || "",
      Fotos_URLs:        fotosURLs,
      Submitter_IP:      "",
    };

    // Guardar en Sheets
    const appendRow = async (range, headers) => {
      await sheetsClient.spreadsheets.values.append({
        spreadsheetId: sheetId, range,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [headers.map(h => rowObj[h])] },
      });
    };

    await appendRow(`${SHEET_RESP}!A:Y`, RESP_HEADERS);
    const tipoRaw = String(fields.Tipo_Evento || "");
    if      (tipoRaw === "Plaga")                          await appendRow("Respuestas_Plaga!A:O",   HDR_PLAGA);
    else if (tipoRaw === "Aroma")                          await appendRow("Respuestas_Aroma!A:N",   HDR_AROMA);
    else if (tipoRaw === "Químico" || tipoRaw === "Quimico") await appendRow("Respuestas_Quimico!A:O", HDR_QUIM);

    // Notificaciones
    await Promise.allSettled([notifyTelegram(rowObj), notifyN8N(rowObj)]);

    return res.status(200).json({ ok: true, Ticket: ticket, Response_ID: responseId, Tienda_ID: tiendaId, warn });

  } catch (e) {
    console.error("submit error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Error interno" });
  }
}
