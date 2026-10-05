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

// 🛡️ BLINDAJE DE SEGURIDAD
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
// 3. NÚCLEO Y PROCESADOR
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
            
            // DETECTOR UNIVERSAL 100% SEGURO
            const senderId = m.key.participant || chat;
            const isCreator = senderId.includes(NUMERO_CREADOR);

            let esAdmin = false;
            let groupMetadata = null;
            if (esGrupo) {
                groupMetadata = await sock.groupMetadata(chat);
                const senderObj = groupMetadata.participants.find(p => p.id === senderId);
                esAdmin = senderObj?.admin === 'admin' || senderObj?.admin === 'superadmin' || isCreator;
            }

            // SISTEMA DE LICENCIAS (BLOQUEADOR)
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
            // MODERACIÓN INTELIGENTE
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

            if (comando === "n") {
                if (!esGrupo || !esAdmin) return;
                let txtMsg = args.join(" ");
                let isQuoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!txtMsg && isQuoted) txtMsg = isQuoted.conversation || isQuoted.extendedTextMessage?.text || isQuoted.imageMessage?.caption || isQuoted.videoMessage?.caption || "";
                
                const fch = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
                const menciones = groupMetadata.participants.map(p => p.id);
                const etiquetasVisibles = menciones.map(x => `@${x.split("@")[0]}`).join(" ");
                const leerMas = String.fromCharCode(8206).repeat(4000); 
                const finalTxt = `${txtMsg}\n\n| 🛡 *${groupMetadata.subject}* • ${fch}${leerMas}\n${etiquetasVisibles}`;

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
                    } else await sock.sendMessage(chat, { text: finalTxt, mentions: menciones });
                } catch (e) { await sock.sendMessage(chat, { text: finalTxt, mentions: menciones }); }
                return;
            }

            if (comando === "kick" || comando === "sacar") {
                if (!esGrupo || !esAdmin) return;
                let target = m.message.extendedTextMessage?.contextInfo?.participant || (m.message.extendedTextMessage?.contextInfo?.mentionedJid ? m.message.extendedTextMessage.contextInfo.mentionedJid[0] : null);
                if (!target) return;
                if (target.includes(NUMERO_CREADOR)) return responder(`${pre}\n║ ⚠️ *BLINDAJE MAESTRO*\n║ Prohibido expulsar al Creador.\n${pie}`);
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
                
                // LA MAGIA: Si eres tú, te pega el panel secreto. Si es cliente, no lo ve.
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
║  └ .doxeo / .parejas
╚══════════════════════════╝`);
            }

            // JUEGOS BÁSICOS 
            if (comando === "suerte") return responder(`${pre}\n║ 🍀 Tienes un *${Math.floor(Math.random() * 101)}%* de suerte.\n${pie}`);

            if (comando === "doxeo") {
                let t = m.message.extendedTextMessage?.contextInfo?.participant || (m.message.extendedTextMessage?.contextInfo?.mentionedJid ? m.message.extendedTextMessage.contextInfo.mentionedJid[0] : null);
                let tag = t ? `@${t.split("@")[0]}` : "el objetivo";
                const rMsg = await sock.sendMessage(chat, { text: `${pre}\n║ ☠️ Hackeando a ${tag}...\n${pie}`, mentions: t ? [t] : [] });
                setTimeout(async () => {
                    await sock.sendMessage(chat, { edit: rMsg.key, text: `${pre}\n║ ☠️ *DOXEO COMPLETADO*\n╠══════════════════════════╣\n║ 📡 IP: 192.168.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}\n║ 📍 Ciudad: Latam\n║ 🌐 WiFi: Vecino_5G\n║ 💳 Tarjeta: 4152 **** **** ${Math.floor(Math.random()*9000)+1000}\n╚══════════════════════════╝` });
                }, 2000);
            }

        } catch (error) { console.error("Error:", error); }
    });
}

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

iniciarBot();
