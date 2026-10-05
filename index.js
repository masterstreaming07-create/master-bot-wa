const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, jidNormalizedUser, downloadContentFromMessage } = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require("express");
const QRCode = require("qrcode");

// ==========================================
// 1. CONFIGURACIÓN Y SERVIDOR WEB
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwsfiLlP7ot1DSHiyLfBdXEMI_6sbt9fD0MXxynwGqPG-HDZPpTLiWffxzrFFLP5Nrl/exec";
const FIREBASE_URL = "https://masterbot-cd954-default-rtdb.firebaseio.com/database.json";

// 🛡️ BLINDAJE DE SEGURIDAD (TUS 10 DÍGITOS REALES)
// Confirma que sean 10 dígitos. Si es 7772404601, déjalo así.
const NUMERO_CREADOR = "7772404601";

let db = { comandos: {}, gruposOTP: {}, mapaGrupos: {}, licencias: {}, pausado: false };

async function cargarDB() {
    try {
        const res = await fetch(FIREBASE_URL);
        const data = await res.json();
        if (data) {
            db.comandos = data.comandos || {};
            db.gruposOTP = data.gruposOTP || {};
            db.mapaGrupos = data.mapaGrupos || {};
            db.licencias = data.licencias || {};
            for (let key in data) if (!['comandos', 'gruposOTP', 'mapaGrupos', 'licencias', 'pausado'].includes(key)) db[key] = data[key];
        }
        console.log("✅ Base de datos sincronizada.");
    } catch (e) { console.log("⚠️ Error en DB."); }
}

async function guardarDB() {
    try { await fetch(FIREBASE_URL, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(db) }); } catch (e) {}
}

let qrActual = null;
let botConectado = false;

app.get("/", async (req, res) => {
    if (botConectado) return res.send(`<h1 style="color: #00ff00; background: #000; text-align: center; padding: 50px; font-family: monospace;">✅ MASTER SYSTEM PRO [ONLINE]</h1>`);
    if (qrActual) {
        try {
            const qrImage = await QRCode.toDataURL(qrActual);
            return res.send(`<div style="text-align: center; margin-top: 30px;"><h2>⚡ ESCANEAR ACCESO ⚡</h2><img src="${qrImage}" style="width: 280px; border: 2px solid #333;" /><script>setTimeout(() => location.reload(), 15000);</script></div>`);
        } catch (e) { return res.send("Generando nodo..."); }
    }
    res.send("Iniciando módulos del sistema...");
});
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));

// ==========================================
// 2. DISEÑO VISUAL
// ==========================================
const pre = "╔══════════════════════════╗\n║ 👑 *MASTER PRO*\n╠══════════════════════════╣";
const sep = "╠══════════════════════════╣";
const pie = "╚══════════════════════════╝";

function obtenerTextoMensaje(m) {
    if (!m || !m.message) return "";
    let msg = m.message;
    if (msg.ephemeralMessage) msg = msg.ephemeralMessage.message;
    if (msg.viewOnceMessage) msg = msg.viewOnceMessage.message;
    if (msg.viewOnceMessageV2) msg = msg.viewOnceMessageV2.message;
    if (msg.documentWithCaptionMessage) msg = msg.documentWithCaptionMessage.message;
    return (msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.videoMessage?.caption || "").trim();
}

// ==========================================
// 3. NÚCLEO Y PROCESADOR DE COMANDOS
// ==========================================
async function iniciarBot() {
    await cargarDB();
    const { state, saveCreds } = await useMultiFileAuthState("auth_session");
    const sock = makeWASocket({ auth: state, logger: pino({ level: "silent" }), printQRInTerminal: true });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) { qrActual = qr; botConectado = false; }
        if (connection === "close") setTimeout(iniciarBot, 5000);
        else if (connection === "open") { botConectado = true; qrActual = null; }
    });

    sock.ev.on("messages.upsert", async (chatUpdate) => {
        try {
            if (!chatUpdate.messages) return;
            const m = chatUpdate.messages[0];
            if (!m.message || m.key.fromMe) return;

            const texto = obtenerTextoMensaje(m);
            const chat = m.key.remoteJid;
            if (!texto || !texto.startsWith(".")) return;

            const args = texto.slice(1).trim().split(/ +/);
            const comando = args.shift().toLowerCase();
            const esGrupo = chat.endsWith("@g.us");

            const responder = async (texto) => await sock.sendMessage(chat, { text: texto }, { quoted: m });
            
            // DETECTOR UNIVERSAL INFALIBLE
            const senderId = m.key.participant || chat;
            const numPuro = senderId.replace(/[^0-9]/g, ""); 
            const isCreator = numPuro.endsWith(NUMERO_CREADOR);

            let esAdmin = false;
            let groupMetadata = null;
            if (esGrupo) {
                groupMetadata = await sock.groupMetadata(chat);
                const senderObj = groupMetadata.participants.find(p => p.id === senderId);
                esAdmin = senderObj?.admin === 'admin' || senderObj?.admin === 'superadmin' || isCreator;
            }

            // SISTEMA DE LICENCIAS (BLOQUEADOR POR FALTA DE PAGO)
            if (esGrupo && !isCreator && comando !== "menu") {
                const vencimiento = db.licencias?.[chat];
                if (vencimiento && Date.now() > vencimiento) {
                    return responder(`${pre}\n║ ⛔ *LICENCIA VENCIDA*\n║ Tu renta de sistema finalizó.\n║ Contacta al Creador para renovar.\n${pie}`);
                }
            }

            // ==========================================
            // CAPA VIP: PANEL SECRETO DEL CREADOR
            // ==========================================
            if (comando === "listagrupos" && isCreator) {
                const grupos = await sock.groupFetchAllParticipating();
                let txt = `╔══════════════════════════╗\n║ 👑 *PANEL DE RENTAS*\n╠══════════════════════════╣\n`;
                let i = 1;
                db.mapaGrupos = {}; 
                for (const jid in grupos) {
                    const pinActivo = db.gruposOTP[jid] ? "✅ SI" : "❌ NO";
                    let vencimiento = "Sin licencia";
                    if (db.licencias[jid]) {
                        const date = new Date(db.licencias[jid]);
                        vencimiento = Date.now() > db.licencias[jid] ? "⚠️ VENCIDA" : date.toLocaleDateString('es-MX');
                    }
                    txt += `║ *${i}.* ${grupos[jid].subject}\n║  ├ 🔑 PIN: ${pinActivo}\n║  └ 📅 Vence: ${vencimiento}\n║\n`;
                    db.mapaGrupos[i] = jid;
                    i++;
                }
                txt += `╚══════════════════════════╝\n_Usa .licencia [días] [num]_\n_Usa .activarpin [num]_`;
                guardarDB();
                return responder(txt);
            }

            if (comando === "licencia" && isCreator) {
                const dias = parseInt(args[0]);
                const num = args[1];
                if (!dias || !num) return responder(`${pre}\n║ ⚠️ Uso: .licencia [días] [num_grupo]\n${pie}`);
                const jid = db.mapaGrupos?.[num];
                if (!jid) return responder(`${pre}\n║ ⚠️ Número de grupo inválido.\n${pie}`);
                
                db.licencias[jid] = Date.now() + (dias * 24 * 60 * 60 * 1000);
                guardarDB();
                return responder(`${pre}\n║ ✅ *LICENCIA ACTIVADA*\n║ Grupo ${num} tiene ${dias} días.\n${pie}`);
            }

            if (comando === "activarpin" && isCreator) {
                const num = args[0];
                const jid = db.mapaGrupos?.[num];
                if (!jid) return;
                db.gruposOTP[jid] = true;
                guardarDB();
                return responder(`${pre}\n║ ✅ *OTP DESBLOQUEADO*\n║ Grupo ${num} tiene acceso a PIN.\n${pie}`);
            }

            if (comando === "desactivarpin" && isCreator) {
                const num = args[0];
                const jid = db.mapaGrupos?.[num];
                if (!jid) return;
                db.gruposOTP[jid] = false;
                guardarDB();
                return responder(`${pre}\n║ ⛔ *OTP BLOQUEADO*\n║ Permiso revocado al grupo ${num}.\n${pie}`);
            }

            // ==========================================
            // MODERACIÓN INTELIGENTE (Cerrar/Abrir con Tiempo)
            // ==========================================
            if (comando === "cerrar" || comando === "abrir") {
                if (!esGrupo || !esAdmin) return;
                const esCerrar = comando === "cerrar";
                const accionConfig = esCerrar ? "announcement" : "not_announcement";
                
                const timeArg = args[0];
                let delayMs = 0; let timeStr = "";

                if (timeArg) {
                    const match = timeArg.match(/^(\d+)([smh])$/i);
                    if (match) {
                        const value = parseInt(match[1]); const unit = match[2].toLowerCase();
                        if (unit === 's') { delayMs = value * 1000; timeStr = `${value} segs`; }
                        else if (unit === 'm') { delayMs = value * 60000; timeStr = `${value} mins`; }
                        else if (unit === 'h') { delayMs = value * 3600000; timeStr = `${value} hrs`; }
                    } else return responder(`${pre}\n║ ⚠️ Uso: .${comando} 5m, 1h, 30s\n${pie}`);
                }

                if (delayMs > 0) {
                    const cDate = new Date(Date.now() + delayMs);
                    const tFormat = cDate.toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute:'2-digit' });
                    
                    const msg = `╔══════════════════════════╗\n║ ⏳ *ORDEN RECIBIDA*\n╠══════════════════════════╣\n║ 👤 Admin: @${senderId.split("@")[0]}\n║ 📍 Grupo: ${groupMetadata.subject}\n║ ⏳ Se ${esCerrar ? "cerrará" : "abrirá"} en: ${timeStr}\n║ 🕒 Hora: ${tFormat} (MX)\n╚══════════════════════════╝`;
                    await sock.sendMessage(chat, { text: msg, mentions: [senderId] }, { quoted: m });

                    setTimeout(async () => {
                        try {
                            await sock.groupSettingUpdate(chat, accionConfig);
                            await sock.sendMessage(chat, { text: `╔══════════════════════════╗\n║ 🛡 *SISTEMA DE SEGURIDAD*\n╠══════════════════════════╣\n║ 🔐 ESTADO: ${esCerrar ? "RESTRINGIDO 🔴" : "PÚBLICO 🟢"}\n╚══════════════════════════╝\n_El tiempo programado ha finalizado._` });
                        } catch (e) {}
                    }, delayMs);
                    return;
                }

                try {
                    await sock.groupSettingUpdate(chat, accionConfig);
                    await sock.sendMessage(chat, { text: `╔══════════════════════════╗\n║ 🛡 *SISTEMA DE SEGURIDAD*\n╠══════════════════════════╣\n║ 🔐 ESTADO: ${esCerrar ? "RESTRINGIDO 🔴" : "PÚBLICO 🟢"}\n╚══════════════════════════╝` });
                } catch (error) { return responder(`${pre}\n║ ❌ Necesitas hacerme Admin.\n${pie}`); }
                return;
            }

            // COMANDO .N (ANUNCIO 100% INVISIBLE)
            if (comando === "n") {
                if (!esGrupo || !esAdmin) return;
                
                let txtMsg = args.join(" ");
                let isQuoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                
                if (!txtMsg && isQuoted) {
                    txtMsg = isQuoted.conversation || isQuoted.extendedTextMessage?.text || isQuoted.imageMessage?.caption || isQuoted.videoMessage?.caption || "";
                }
                
                if (!txtMsg && !isQuoted && !m.message.imageMessage && !m.message.videoMessage) {
                    return responder(`${pre}\n║ ⚠️️ Escribe un mensaje o responde a una imagen.\n${pie}`);
                }
                
                const fch = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
                // Aquí armamos el texto LIMPIO, sin arrobas visibles
                const finalTxt = `${txtMsg}\n\n| 🛡 *${groupMetadata.subject}* • ${fch}`;
                
                // Obtenemos los participantes reales para inyectarlos en "mentions" (esto hace que suene la notificación)
                const menciones = groupMetadata.participants.map(p => p.id);

                try {
                    let buffer = null; let msgType = null;
                    if (m.message.imageMessage || m.message.videoMessage) {
                        msgType = m.message.imageMessage ? 'image' : 'video';
                        const stream = await downloadContentFromMessage(m.message[msgType + 'Message'], msgType);
                        buffer = Buffer.from([]); for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    } else if (isQuoted && (isQuoted.imageMessage || isQuoted.videoMessage)) {
                        msgType = isQuoted.imageMessage ? 'image' : 'video';
                        const stream = await downloadContentFromMessage(isQuoted[msgType + 'Message'], msgType);
                        buffer = Buffer.from([]); for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    }

                    if (buffer) {
                        if (msgType === 'image') await sock.sendMessage(chat, { image: buffer, caption: finalTxt, mentions: menciones });
                        else await sock.sendMessage(chat, { video: buffer, caption: finalTxt, mentions: menciones });
                    } else {
                        await sock.sendMessage(chat, { text: finalTxt, mentions: menciones });
                    }
                } catch (e) { await sock.sendMessage(chat, { text: finalTxt, mentions: menciones }); }
                return;
            }

            if (comando === "kick" || comando === "sacar") {
                if (!esGrupo || !esAdmin) return;
                let target = m.message.extendedTextMessage?.contextInfo?.participant || (m.message.extendedTextMessage?.contextInfo?.mentionedJid ? m.message.extendedTextMessage.contextInfo.mentionedJid[0] : null);
                if (!target) return;
                
                if (target.replace(/[^0-9]/g, "").endsWith(NUMERO_CREADOR)) {
                    return responder(`${pre}\n║ ⚠️ *BLINDAJE MAESTRO*\n║ Prohibido expulsar al Creador.\n${pie}`);
                }
                try {
                    await sock.groupParticipantsUpdate(chat, [target], "remove");
                    return responder(`${pre}\n║ 👢 Usuario eliminado.\n${pie}`);
                } catch (e) {}
            }

            if (comando === "link") {
                if (!esGrupo || !esAdmin) return;
                try {
                    const code = await sock.groupInviteCode(chat);
                    return responder(`${pre}\n║ 🔗 *ENLACE DEL GRUPO*\n║ https://chat.whatsapp.com/${code}\n${pie}`);
                } catch (e) {}
            }

            if (comando === "tagall") {
                if (!esGrupo || !esAdmin) return;
                let msgTag = `╔══════════════════════════╗\n║ 📢 *LLAMADO GENERAL*\n╠══════════════════════════╣\n`;
                const menciones = groupMetadata.participants.map(p => { msgTag += `║ • @${p.id.split("@")[0]}\n`; return p.id; });
                msgTag += `╚══════════════════════════╝`;
                await sock.sendMessage(chat, { text: msgTag, mentions: menciones });
                return;
            }

            // ==========================================
            // EXTRACCIÓN OTP
            // ==========================================
            if (comando === "pin" || comando === "extraer") {
                if (!esGrupo || !esAdmin) return responder(`${pre}\n║ ⛔ Solo administradores.\n${pie}`);
                if (!db.gruposOTP[chat] && !isCreator) return responder(`${pre}\n║ ⛔ *SERVICIO RESTRINGIDO*\n║ Tu grupo no tiene plan OTP.\n${pie}`);

                const plat = args[0]?.trim().toLowerCase();
                const corr = args[1]?.trim().toLowerCase();
                const sub = args[2] ? args[2].trim().toLowerCase() : "4dig";
                if (!plat || !corr?.includes("@")) return responder(`${pre}\n║ ⚠️ Uso: .pin [plat] [correo]\n${pie}`);

                await responder(`${pre}\n║ ⏳ *Extrayendo en vivo...*\n${pie}`);
                try {
                    const res = await fetch(`${APPS_SCRIPT_URL}?accion=extraer&plataforma=${encodeURIComponent(plat)}&correo=${encodeURIComponent(corr)}&subtipo=${encodeURIComponent(sub)}`);
                    const data = await res.json();
                    if (data?.ok) {
                        let ok = `╔══════════════════════════╗\n║ ✅ *CÓDIGO RECIBIDO*\n╠══════════════════════════╣\n║ 📺 Servicio: ${data.type || plat.toUpperCase()}\n║ 🔑 OTP: *${data.code}*\n`;
                        if (data.link) ok += `║ 🔗 Hogar: ${data.link}\n`;
                        ok += `╚══════════════════════════╝`;
                        await sock.sendMessage(chat, { text: ok }, { quoted: m });
                    } else responder(`${pre}\n║ ❌ *ERROR*\n║ ${data.error || "Código caducado."}\n${pie}`);
                } catch (e) {}
                return;
            }

            // ==========================================
            // BASE DE DATOS LOCAL (.SET)
            // ==========================================
            if (comando === "activar") {
                if (!esGrupo || !esAdmin) return;
                if (!db[chat]) db[chat] = { comandos: {} };
                guardarDB();
                return responder(`${pre}\n║ ✅ *DB INICIADA*\n║ Ya puedes usar .set en el grupo.\n${pie}`);
            }

            if (comando === "set" && esAdmin) {
                const nCmd = args.shift()?.toLowerCase();
                if (!nCmd || !args.length) return responder(`${pre}\n║ ⚠️ Uso: .set [nombre] [texto]\n${pie}`);
                if (esGrupo && !db[chat]) return responder(`${pre}\n║ ⛔ Activa la DB con .activar\n${pie}`);
                if (esGrupo) db[chat].comandos[nCmd] = args.join(" "); else db.comandos[nCmd] = args.join(" "); 
                guardarDB();
                return responder(`${pre}\n║ ✅ Comando .${nCmd} guardado.\n${pie}`);
            }

            if (comando === "del" && esAdmin) {
                const nCmd = args[0]?.toLowerCase();
                if (esGrupo && db[chat]?.comandos[nCmd]) delete db[chat].comandos[nCmd];
                else if (!esGrupo && db.comandos[nCmd]) delete db.comandos[nCmd];
                guardarDB();
                return responder(`${pre}\n║ 🗑️ Comando eliminado.\n${pie}`);
            }

            let respCmd = null;
            if (esGrupo && db[chat]?.comandos[comando]) respCmd = db[chat].comandos[comando];
            else if (db.comandos[comando]) respCmd = db.comandos[comando]; 
            if (respCmd) return responder(`╔══════════════════════════╗\n║ 💡 *INFORMACIÓN*\n╠══════════════════════════╣\n║ ${respCmd}\n╚══════════════════════════╝`);

            // ==========================================
            // ENTRETENIMIENTO Y JUEGOS COMPLETOS
            // ==========================================
            if (comando === "carrera") {
                const msg = await sock.sendMessage(chat, { text: `${pre}\n║ 🏁 Preparando pista...\n${pie}` }, { quoted: m });
                const frames = [
                    `${pre}\n║ 🏁 *CARRERA EN CURSO*\n╠══════════════════════════╣\n║ 🚗💨          🏎️💨\n║\n║ _¡Arrancan!_\n${pie}`,
                    `${pre}\n║ 🏁 *CARRERA EN CURSO*\n╠══════════════════════════╣\n║    🚗💨      🏎️💨\n║\n║ _¡Curva peligrosa!_\n${pie}`,
                    `${pre}\n║ 🏁 *CARRERA EN CURSO*\n╠══════════════════════════╣\n║       🚗💨  🏎️💨\n║\n║ _¡Están parejos!_\n${pie}`,
                    `${pre}\n║ 🏁 *FINAL DE FOTOGRAFÍA*\n╠══════════════════════════╣\n║             🚗💨🏎️💨\n║\n║ 🏆 ¡GANA EL AUTO ROJO! 🏆\n${pie}`
                ];
                for (let i = 0; i < frames.length; i++) {
                    await new Promise(r => setTimeout(r, 1200));
                    await sock.sendMessage(chat, { edit: msg.key, text: frames[i] });
                }
                return;
            }

            if (comando === "bomba") {
                const msg = await sock.sendMessage(chat, { text: `${pre}\n║ 💣 *BOMBA ACTIVADA*\n╠══════════════════════════╣\n║ Destrucción en: ⏳ 3...\n${pie}` }, { quoted: m });
                await new Promise(r => setTimeout(r, 1200));
                await sock.sendMessage(chat, { edit: msg.key, text: `${pre}\n║ 💣 *BOMBA ACTIVADA*\n╠══════════════════════════╣\n║ Destrucción en: ⏳ 2...\n${pie}` });
                await new Promise(r => setTimeout(r, 1200));
                await sock.sendMessage(chat, { edit: msg.key, text: `${pre}\n║ 💣 *BOMBA ACTIVADA*\n╠══════════════════════════╣\n║ Destrucción en: ⏳ 1...\n${pie}` });
                await new Promise(r => setTimeout(r, 1200));
                await sock.sendMessage(chat, { edit: msg.key, text: `💥💥💥 *¡KABOOM!* 💥💥💥\n\n_El chat ha quedado en ruinas._` });
                return;
            }

            if (comando === "casino" || comando === "slots") {
                const msg = await sock.sendMessage(chat, { text: `${pre}\n║ 🎰 Girando rodillos...\n║ [ 🌀 | 🌀 | 🌀 ]\n${pie}` }, { quoted: m });
                const emojis = ["🍒", "🔔", "💎", "🍋", "🍉"];
                setTimeout(async () => {
                    const r1 = emojis[Math.floor(Math.random() * emojis.length)];
                    const r2 = emojis[Math.floor(Math.random() * emojis.length)];
                    const r3 = emojis[Math.floor(Math.random() * emojis.length)];
                    const win = (r1 === r2 && r2 === r3) ? "¡PREMIO MAYOR! 💰💰" : "Sigue intentando... 📉";
                    await sock.sendMessage(chat, { edit: msg.key, text: `${pre}\n║ 🎰 *RESULTADO*\n╠══════════════════════════╣\n║ [ ${r1} | ${r2} | ${r3} ]\n║\n║ ${win}\n${pie}` });
                }, 1500);
                return;
            }

            if (comando === "dado") {
                const msg = await sock.sendMessage(chat, { text: `${pre}\n║ 🎲 Agitando el dado... 🌪️\n${pie}` }, { quoted: m });
                setTimeout(async () => {
                    const cara = Math.floor(Math.random() * 6) + 1;
                    await sock.sendMessage(chat, { edit: msg.key, text: `${pre}\n║ 🎲 El dado cayó en: *${cara}* ✅\n${pie}` });
                }, 1000);
                return;
            }

            if (comando === "ruleta") {
                if (!esGrupo) return;
                if (esAdmin) return responder(`${pre}\n║ 🛡️ Los Admins no juegan.\n${pie}`);
                const msg = await sock.sendMessage(chat, { text: `${pre}\n║ 🔫 Girando el tambor... ⚙\n${pie}` }, { quoted: m });
                setTimeout(async () => {
                    if (Math.floor(Math.random() * 6) + 1 === 1) {
                        await sock.sendMessage(chat, { edit: msg.key, text: `${pre}\n║ 🔫 ¡PUM! 💥 Perdiste.\n${pie}` });
                        try { await sock.groupParticipantsUpdate(chat, [m.key.participant], "remove"); } catch(e) {}
                    } else {
                        await sock.sendMessage(chat, { edit: msg.key, text: `${pre}\n║ 🔫 Click... Te salvaste. 😅\n${pie}` });
                    }
                }, 2000);
                return;
            }

            if (comando === "suerte") {
                return responder(`${pre}\n║ 🍀 Tienes un *${Math.floor(Math.random() * 101)}%* de suerte.\n${pie}`);
            }

            if (comando === "doxeo" || comando === "doxxear") {
                let target = m.message.extendedTextMessage?.contextInfo?.participant || (m.message.extendedTextMessage?.contextInfo?.mentionedJid ? m.message.extendedTextMessage.contextInfo.mentionedJid[0] : null);
                let tag = target ? `@${target.split("@")[0]}` : "este usuario";
                
                const isps = ["Telmex (Debe 2 meses)", "Totalplay (Amenaza cancelar)", "Megacable (Robando WiFi)", "Izzi (Con cortes)", "Starlink (Es prestado)"];
                const locs = ["Ecatepec, Edomex", "San Pedro Garza García", "Tepito, CDMX", "Zapopan, Jalisco", "Culiacán, Sinaloa"];
                const devices = ["Alcatel con pantalla rota", "iPhone 15 Pro Max (En abonos)", "Samsung Galaxy J7", "Xiaomi (A punto de explotar)"];
                const secrets = ["Buscó: 'cómo volver con mi ex'", "Debe $500 en la tienda", "Escucha a Bad Bunny a escondidas", "Tiene fotos vergonzosas"];
                
                const ip = `${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;
                const call = await sock.sendMessage(chat, { text: `${pre}\n║ ☠️ Rastreando IP de ${tag}...\n${pie}`, mentions: target ? [target] : [] });
                
                setTimeout(async () => {
                    const ispInfo = isps[Math.floor(Math.random() * isps.length)];
                    const locInfo = locs[Math.floor(Math.random() * locs.length)];
                    const devInfo = devices[Math.floor(Math.random() * devices.length)];
                    const secInfo = secrets[Math.floor(Math.random() * secrets.length)];
                    
                    await sock.sendMessage(chat, { edit: call.key, text: `╔══════════════════════════╗\n║ ☠️ *DOXEO COMPLETADO*\n╠══════════════════════════╣\n║ 👤 Objetivo: ${tag}\n║ 📡 IP: ${ip}\n║ 📍 Ubicación: ${locInfo}\n║ 🌐 WiFi: ${ispInfo}\n║ 📱 Dispositivo: ${devInfo}\n║ 💳 Tarjeta: 4152 **** **** ${Math.floor(Math.random()*9000)+1000}\n║\n║ 🕵️‍♂️ *Secreto expuesto:*\n║ › ${secInfo}\n╚══════════════════════════╝`, mentions: target ? [target] : [] });
                }, 3000);
                return;
            }

            if (comando === "calentura" || comando === "pajero" || comando === "lesbiometro") {
                let target = m.message.extendedTextMessage?.contextInfo?.participant || (m.message.extendedTextMessage?.contextInfo?.mentionedJid ? m.message.extendedTextMessage.contextInfo.mentionedJid[0] : null);
                let tag = target ? `@${target.split("@")[0]}` : "este usuario";
                const nivel = Math.floor(Math.random() * 101);
                let diag = nivel > 80 ? "🔥 ¡Báñate con agua fría!" : nivel > 40 ? "😏 Andas en el punto exacto." : "🧊 Eres un témpano de hielo.";
                return await sock.sendMessage(chat, { text: `╔══════════════════════════╗\n║ 🌡️ *TEST DE ${comando.toUpperCase()}*\n╠══════════════════════════╣\n║ 👤 Analizando a: ${tag}\n║ 📊 Nivel: ${nivel}%\n║ 🩺 Diagnóstico: ${diag}\n╚══════════════════════════╝`, mentions: target ? [target] : [] });
            }

            if (comando === "ship" || comando === "parejas") {
                if (!esGrupo) return;
                const miembros = groupMetadata.participants.map(p => p.id);
                const miembrosReales = miembros.filter(id => id !== sock.user.id.split(":")[0]+"@s.whatsapp.net");
                const user1 = miembrosReales[Math.floor(Math.random() * miembrosReales.length)];
                const user2 = miembrosReales[Math.floor(Math.random() * miembrosReales.length)];
                return await sock.sendMessage(chat, { text: `╔══════════════════════════╗\n║ 💘 *NUEVA PAREJA*\n╠══════════════════════════╣\n║ 👉 @${user1.split("@")[0]}\n║ 👉 @${user2.split("@")[0]}\n║\n║ ¡Ya bésense y dejen el drama! 👩‍❤️‍💋‍👨\n╚══════════════════════════╝`, mentions: [user1, user2] });
            }

            if (comando === "piropo") {
                const piropos = ["Si la belleza fuera delito, yo te daría cadena perpetua. 😘", "¿Crees en el amor a primera vista o vuelvo a pasar? 😉", "No soy donante de órganos, pero te doy mi corazón. ❤️", "Quien fuera sol para darte todo el día. ☀️", "Me gustas más que dormir hasta tarde. 😴", "Estás como para invitarte a comer taquitos. 🌮"];
                const random = piropos[Math.floor(Math.random() * piropos.length)];
                return responder(`${pre}\n║ 😏 ${random}\n${pie}`);
            }

            // ==========================================
            // MENÚ PRINCIPAL Y SUBMENÚS
            // ==========================================
            if (comando === "menu" || comando === "help") {
                const fch = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
                let menuTxt = `╔══════════════════════════╗
║  🤖 *MASTER SYSTEM*
║  📋 *Menú Principal*
║  📅 ${fch}
╠══════════════════════════╣
║ 🛒 CATÁLOGO DE VENTAS
║  ├ Crea tu propio catálogo
║  ├ de forma fácil usando
║  └ el comando: .set
║
║ 🔐 SISTEMA OTP
║  └ .pin [plat] [correo]
║
║ ⚙️ MODERACIÓN
║  ├ .cerrar [5m] / .abrir [1h]
║  ├ .n [texto] - Anuncio
║  ├ .kick [@user]
║  ├ .link / .tagall
║  └ .activar - Iniciar Bot
║
║ 🎮 ENTRETENIMIENTO
║  └ .juegos - Ver catálogo
╚══════════════════════════╝`;
                
                if (isCreator) {
                    menuTxt += `\n\n╔══════════════════════════╗\n║ 👑 *ZONA CREADOR*\n╠══════════════════════════╣\n║  ├ .listagrupos\n║  ├ .licencia [días] [num]\n║  └ .activarpin [num]\n╚══════════════════════════╝`;
                }
                
                let imgUrl = "https://i.imgur.com/OFOwV0Y.jpeg"; 
                try {
                    const botJid = jidNormalizedUser(sock.user.id);
                    const profilePic = await sock.profilePictureUrl(botJid, 'image');
                    if (profilePic) imgUrl = profilePic;
                } catch (e) {}

                try { await sock.sendMessage(chat, { image: { url: imgUrl }, caption: menuTxt }, { quoted: m }); } 
                catch(e) { await sock.sendMessage(chat, { text: menuTxt }, { quoted: m }); }
                return;
            }

            if (comando === "juegos" || comando === "entretenimiento") {
                return responder(`╔══════════════════════════╗
║ 🎮 *MINIJUEGOS*
╠══════════════════════════╣
║  ├ .carrera / .bomba
║  ├ .casino / .dado
║  ├ .ruleta / .suerte
║  ├ .doxeo / .parejas
║  ├ .calentura / .pajero
║  └ .piropo
╚══════════════════════════╝`);
            }

        } catch (error) { console.error("Error:", error); }
    });
}

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

iniciarBot();
