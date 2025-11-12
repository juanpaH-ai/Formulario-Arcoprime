export const config = { runtime: "edge" };

export default async function handler() {
  const env = (globalThis as any).process?.env || {};
  const token = env.TELEGRAM_BOT_TOKEN;
  const chats = String(env.TELEGRAM_CHAT_IDS || "")
    .split(",").map((s:string)=>s.trim()).filter(Boolean);

  if (!token || !chats.length) {
    return new Response(JSON.stringify({ ok:false, error:"Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_IDS" }), {
      status:400, headers:{ "Content-Type":"application/json" }
    });
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const text = "✅ Prueba de Telegram desde Vercel: todo OK.";

  const results = await Promise.allSettled(
    chats.map(chat_id => fetch(url, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ chat_id, text })
    }))
  );

  return new Response(JSON.stringify({ ok:true, results: results.map(r => r.status) }), {
    status:200, headers:{ "Content-Type":"application/json" }
  });
}
