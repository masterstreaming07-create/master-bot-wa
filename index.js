const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, jidNormalizedUser, downloadContentFromMessage } = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require("express");
const QRCode = require("qrcode");
const https = require("https");

// ==========================================
// 1. CONFIGURACIÓN Y SERVIDOR WEB
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwsfiLlP7ot1DSHiyLfBdXEMI_6sbt9fD0MXxynwGqPG-HDZPpTLiWffxzrFFLP5Nrl/exec";

// ☁️ CAJA FUERTE EN LA NUBE
const FIREBASE_URL = "https://masterbot-cd954-default-rtdb.firebaseio.com/database.json";

let db = { comandos: {}, gruposOTP: {}, mapaGrupos: {}, licencias: {}, pinUsers: {}, creador: "", bienvenida: {}, despedida: {}, pausado: false };

// CONEXIÓN A FIREBASE BLINDADA
async function cargarDB() {
    return new Promise((resolve) => {
        https.get(FIREBASE_URL, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (data && typeof data === 'object') {
                        db.comandos = data.comandos || {};
                        db.gruposOTP = data.gruposOTP || {};
                        db.mapaGrupos = data.mapaGrupos || {};
                        db.licencias = data.licencias || {};
                        db.pinUsers = data.pinUsers || {}; 
                        db.creador = data.creador || ""; 
                        db.bienvenida = data.bienvenida || {};
                        db.despedida = data.despedida || {};
                        for (let key in data) if (!['comandos', 'gruposOTP', 'mapaGrupos', 'licencias', 'pinUsers', 'creador', 'bienvenida', 'despedida', 'pausado'].includes(key)) db[key] = data[key];
                    }
                    console.log("✅ Base de datos cargada desde la nube.");
                    resolve();
                } catch (e) { resolve(); }
            });
        }).on('error', () => resolve());
    });
}

function guardarDB() {
    return new Promise((resolve) => {
        try {
            const dataStr = JSON.stringify(db);
            const options = { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dataStr) } };
            const req = https.request(FIREBASE_URL, options, (res) => {
                res.on('data', () => {}); 
                res.on('end', () => resolve(true));
            });
            req.on('error', (e) => { console.log("⚠️ Error FB:", e.message); resolve(false); });
            req.write(dataStr);
            req.end();
        } catch (e) { resolve(false); }
    });
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
    res.send("Iniciando módulos...");
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

    // ==========================================
    // SISTEMA DE BIENVENIDA Y DESPEDIDA
    // ==========================================
    sock.ev.on("group-participants.update", async (anu) => {
        try {
            const jid = anu.id;
            const participants = anu.participants;
            
            for (let num of participants) {
                // Obtener Foto de perfil (o la del bot si la tienen oculta)
                let pfp;
                try { pfp = await sock.profilePictureUrl(num, 'image'); } 
                catch { 
                    try { pfp = await sock.profilePictureUrl(jidNormalizedUser(sock.user.id), 'image'); } 
                    catch { pfp = "https://i.imgur.com/OFOwV0Y.jpeg"; }
                }

                if (anu.action === 'add' && db.bienvenida && db.bienvenida[jid]) {
                    const groupMeta = await sock.groupMetadata(jid);
                    const text = `╔══════════════════════════╗\n║ 🎉 *¡NUEVO MIEMBRO!*\n╠══════════════════════════╣\n║ Bienvenido(a) @${num.split("@")[0]}\n║ al grupo: *${groupMeta.subject}*\n║\n║ Esperamos que disfrutes\n║ tu estancia. Escribe .menu\n╚══════════════════════════╝`;
                    await sock.sendMessage(jid, { image: { url: pfp }, caption: text, mentions: [num] });
                } 
                else if (anu.action === 'remove' && db.despedida && db.despedida[jid]) {
                    const despedidas = [
                        "Se nos fue un soldado... 🪖",
                        "¡Hasta la vista, baby! 🕶️",
                        "Un usuario menos que alimentar. 🍽️",
                        "Esperemos que vuelva con pan. 🍞",
                        "Fue eliminado o huyó, nunca lo sabremos. 🕵️‍♂️",
                        "El grupo le quedó grande. 🚀"
                    ];
                    const randomDespedida = despedidas[Math.floor(Math.random() * despedidas.length)];
                    const text = `╔══════════════════════════╗\n║ 👋 *¡SE FUE!*\n╠══════════════════════════╣\n║ Adiós @${num.split("@")[0]}\n║\n║ ${randomDespedida}\n╚══════════════════════════╝`;
                    await sock.sendMessage(jid, { image: { url: pfp }, caption: text, mentions: [num] });
                }
            }
        } catch (err) { console.error("Error en evento de grupo:", err); }
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
            const senderId = m.key.participant || chat;

            // ==========================================
            // AUTO-REGISTRO DEL CREADOR
            // ==========================================
            if (comando === "soycreador") {
                if (db.creador !== "" && db.creador !== senderId) return responder(`${pre}\n║ ⚠️ El bot ya tiene un dueño.\n${pie}`);
                db.creador = senderId;
                await guardarDB();
                return responder(`╔══════════════════════════╗\n║ 👑 *CREADOR RECONOCIDO*\n╠══════════════════════════╣\n║ Se ha vinculado tu número:\n║ ${senderId.split("@")[0]}\n║\n║ Tienes control absoluto.\n╚══════════════════════════╝`);
            }

            const isCreator = (db.creador === senderId);

            let esAdmin = false;
            let groupMetadata = null;
            if (esGrupo) {
                groupMetadata = await sock.groupMetadata(chat);
                const senderObj = groupMetadata.participants.find(p => p.id === senderId);
                esAdmin = senderObj?.admin === 'admin' || senderObj?.admin === 'superadmin' || isCreator;
            }

            // SISTEMA DE LICENCIAS (BLOQUEADOR)
            if (esGrupo && !isCreator && comando !== "menu" && comando !== "nube") {
                const vencimiento = db.licencias?.[chat];
                if (vencimiento && Date.now() > vencimiento) {
                    return responder(`${pre}\n║ ⛔ *LICENCIA VENCIDA*\n║ Tu renta de sistema finalizó.\n║ Contacta al Creador para renovar.\n${pie}`);
                }
            }

            // ==========================================
            // CAPA VIP: PANEL SECRETO DEL CREADOR
            // ==========================================
            if (comando === "nube" && isCreator) {
                const exito = await guardarDB();
                if (exito) return responder(`╔══════════════════════════╗\n║ ☁️ *ESTADO DE LA NUBE*\n╠══════════════════════════╣\n║ ✅ Conexión Excelente.\n║ Tus comandos y stocks están\n║ blindados en Firebase.\n╚══════════════════════════╝`);
                else return responder(`${pre}\n║ ⚠️ Problemas con Firebase.\n${pie}`);
            }

            if (comando === "listagrupos" && isCreator) {
                const grupos = await sock.groupFetchAllParticipating();
                let txt = `╔══════════════════════════╗\n║ 👑 *PANEL DE RENTAS*\n╠══════════════════════════╣\n`;
                let i = 1; db.mapaGrupos = {}; 
                for (const jid in grupos) {
                    const pinActivo = db.gruposOTP[jid] ? "✅ SI" : "❌ NO";
                    let vencimiento = "Sin licencia";
                    if (db.licencias[jid]) {
                        const date = new Date(db.licencias[jid]);
                        vencimiento = Date.now() > db.licencias[jid] ? "⚠ VENCIDA" : date.toLocaleDateString('es-MX');
                    }
                    txt += `║ *${i}.* ${grupos[jid].subject}\n║  ├ 🔑 PIN: ${pinActivo}\n║  └ 📅 Vence: ${vencimiento}\n║\n`;
                    db.mapaGrupos[i] = jid; i++;
                }
                txt += `╚══════════════════════════╝`;
                await guardarDB();
                return responder(txt);
            }

            // ACTIVACIÓN REMOTA
            if (comando === "licencia" && isCreator) {
                const dias = parseInt(args[0]); const num = args[1];
                if (!dias || !num) return responder(`${pre}\n║ ⚠️ Uso: .licencia [días] [num]\n${pie}`);
                const jid = db.mapaGrupos?.[num]; if (!jid) return responder(`${pre}\n║ ⚠️ Grupo inválido.\n${pie}`);
                
                db.licencias[jid] = Date.now() + (dias * 24 * 60 * 60 * 1000);
                if (!db[jid]) db[jid] = { comandos: {} }; 
                await guardarDB();
                
                try { await sock.sendMessage(jid, { text: `╔══════════════════════════╗\n║ 🤖 *SISTEMA ACTIVADO*\n╠══════════════════════════╣\n║ ✅ El Creador ha activado\n║ este bot remotamente.\n║ 📅 Licencia: ${dias} días.\n║\n║ Ya pueden usar .menu\n╚══════════════════════════╝` }); } catch(e) {}
                return responder(`${pre}\n║ ✅ *LICENCIA ACTIVADA*\n║ Grupo ${num} tiene ${dias} días.\n║ (El bot ya avisó allá).\n${pie}`);
            }

            // GESTIÓN DE PERMISOS PIN GENERALES
            if (comando === "activarpin" && isCreator) {
                const num = args[0]; const jid = db.mapaGrupos?.[num]; if (!jid) return;
                db.gruposOTP[jid] = true; await guardarDB();
                return responder(`${pre}\n║ ✅ *OTP DESBLOQUEADO*\n║ Grupo ${num} tiene acceso a PIN.\n${pie}`);
            }

            if (comando === "desactivarpin" && isCreator) {
                const num = args[0]; const jid = db.mapaGrupos?.[num]; if (!jid) return;
                db.gruposOTP[jid] = false; await guardarDB();
                return responder(`${pre}\n║ ⛔ *OTP BLOQUEADO*\n║ Permiso revocado al grupo ${num}.\n${pie}`);
            }

            // GESTIÓN DE OPERADORES PIN
            if (comando === "addpin" && isCreator) {
                if (!esGrupo) return responder(`${pre}\n║ ⚠️ Usa esto dentro del grupo.\n${pie}`);
                let target = m.message.extendedTextMessage?.contextInfo?.participant || (m.message.extendedTextMessage?.contextInfo?.mentionedJid ? m.message.extendedTextMessage.contextInfo.mentionedJid[0] : null);
                if (!target) return responder(`${pre}\n║ ⚠️ Etiqueta a la persona.\n║ Ej: .addpin @Cliente\n${pie}`);
                if (!db.pinUsers) db.pinUsers = {}; if (!db.pinUsers[chat]) db.pinUsers[chat] = [];
                if (!db.pinUsers[chat].includes(target)) db.pinUsers[chat].push(target);
                await guardarDB();
                return responder(`╔══════════════════════════╗\n║ 🔑 *OPERADOR REGISTRADO*\n╠══════════════════════════╣\n║ @${target.split("@")[0]} ahora tiene\n║ licencia para usar el .pin\n╚══════════════════════════╝`, { mentions: [target] });
            }

            if (comando === "delpin" && isCreator) {
                if (!esGrupo) return;
                let target = m.message.extendedTextMessage?.contextInfo?.participant || (m.message.extendedTextMessage?.contextInfo?.mentionedJid ? m.message.extendedTextMessage.contextInfo.mentionedJid[0] : null);
                if (!target) return;
                if (db.pinUsers && db.pinUsers[chat]) {
                    db.pinUsers[chat] = db.pinUsers[chat].filter(id => id !== target);
                    await guardarDB();
                }
                return responder(`╔══════════════════════════╗\n║ 🗑️ *LICENCIA REVOCADA*\n╠══════════════════════════╣\n║ @${target.split("@")[0]} ya no puede\n║ extraer códigos.\n╚══════════════════════════╝`, { mentions: [target] });
            }

            // ==========================================
            // EXTRACCIÓN OTP (CON VALIDACIÓN DE OPERADOR)
            // ==========================================
            if (comando === "pin" || comando === "extraer") {
                if (!esGrupo) return responder(`${pre}\n║ ⛔ Solo funciona en grupos.\n${pie}`);
                const autorizado = isCreator || (db.pinUsers && db.pinUsers[chat] && db.pinUsers[chat].includes(senderId));
                if (!autorizado) return responder(`╔══════════════════════════╗\n║ ⛔ *ACCESO DENEGADO*\n╠══════════════════════════╣\n║ Solo el Creador y los\n║ Operadores autorizados\n║ pueden extraer códigos.\n╚══════════════════════════╝`);
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
                    } else responder(`${pre}\n║ ❌ *ERROR*\n║ ${data.error || "Código no hallado."}\n${pie}`);
                } catch (e) { responder(`${pre}\n║ ⚠️ Servidor caído o en pausa.\n${pie}`); }
                return;
            }

            // ==========================================
            // ACTIVAR FUNCIONES Y BASE DE DATOS
            // ==========================================
            if (comando === "activar") {
                if (!esGrupo || !esAdmin) return;
                if (args[0] === "bienvenida") {
                    if (!db.bienvenida) db.bienvenida = {}; db.bienvenida[chat] = true; await guardarDB();
                    return responder(`${pre}\n║ ✅ Bienvenida ACTIVADA.\n${pie}`);
                }
                if (args[0] === "despedida") {
                    if (!db.despedida) db.despedida = {}; db.despedida[chat] = true; await guardarDB();
                    return responder(`${pre}\n║ ✅ Despedida ACTIVADA.\n${pie}`);
                }
                // Si solo pone .activar (DB normal)
                if (!db[chat]) db[chat] = { comandos: {} };
                await guardarDB();
                return responder(`${pre}\n║ ✅ *DB INICIADA*\n║ Ya puedes usar .set en el grupo.\n${pie}`);
            }

            if (comando === "desactivar") {
                if (!esGrupo || !esAdmin) return;
                if (args[0] === "bienvenida") {
                    if (!db.bienvenida) db.bienvenida = {}; db.bienvenida[chat] = false; await guardarDB();
                    return responder(`${pre}\n║ ⛔ Bienvenida DESACTIVADA.\n${pie}`);
                }
                if (args[0] === "despedida") {
                    if (!db.despedida) db.despedida = {}; db.despedida[chat] = false; await guardarDB();
                    return responder(`${pre}\n║ ⛔ Despedida DESACTIVADA.\n${pie}`);
                }
            }

            // ==========================================
            // COMANDOS LOCALES (.SET) AISLADOS
            // ==========================================
            if (comando === "set" && esAdmin) {
                const nCmd = args.shift()?.toLowerCase();
                if (!nCmd || !args.length) return responder(`${pre}\n║ ⚠️️ Uso: .set [nombre] [texto]\n${pie}`);
                if (esGrupo && !db[chat]) return responder(`${pre}\n║ ⛔ Activa la DB con .activar\n${pie}`);
                
                if (esGrupo) {
                    if (!db[chat].comandos) db[chat].comandos = {};
                    db[chat].comandos[nCmd] = args.join(" ");
                } else { db.comandos[nCmd] = args.join(" "); }
                
                await guardarDB();
                return responder(`${pre}\n║ ✅ Comando .${nCmd} guardado.\n${pie}`);
            }

            if (comando === "del" && esAdmin) {
                const nCmd = args[0]?.toLowerCase();
                if (esGrupo && db[chat]?.comandos && db[chat].comandos[nCmd]) delete db[chat].comandos[nCmd];
                else if (!esGrupo && db.comandos[nCmd]) delete db.comandos[nCmd];
                await guardarDB();
                return responder(`${pre}\n║ 🗑️ Comando eliminado.\n${pie}`);
            }

            let respCmd = null;
            if (esGrupo && db[chat]?.comandos && db[chat].comandos[comando]) respCmd = db[chat].comandos[comando];
            else if (db.comandos[comando]) respCmd = db.comandos[comando]; 
            
            if (respCmd) {
                if (respCmd.includes("╔═════")) return responder(respCmd);
                return responder(`╔══════════════════════════╗\n║ 💡 *INFORMACIÓN*\n╠══════════════════════════╣\n║ ${respCmd}\n╚══════════════════════════╝`);
            }

            // ==========================================
            // MODERACIÓN INTELIGENTE 
            // ==========================================
            if (comando === "cerrar" || comando === "abrir") {
                if (!esGrupo || !esAdmin) return;
                const esCerrar = comando === "cerrar";
                const accionConfig = esCerrar ? "announcement" : "not_announcement";
                const timeArg = args[0]; let delayMs = 0; let timeStr = "";

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
                            await sock.sendMessage(chat, { text: `╔══════════════════════════╗\n║ 🛡 *SISTEMA DE SEGURIDAD*\n╠══════════════════════════╣\n║ 🔐 ESTADO: ${esCerrar ? "RESTRINGIDO 🔴" : "PÚBLICO 🟢"}\n╚══════════════════════════╝\n_Tiempo finalizado._` });
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

            // COMANDO .N (ANUNCIO INVISIBLE)
            if (comando === "n") {
                if (!esGrupo || !esAdmin) return;
                let txtMsg = args.join(" ");
                let isQuoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!txtMsg && isQuoted) { txtMsg = isQuoted.conversation || isQuoted.extendedTextMessage?.text || isQuoted.imageMessage?.caption || isQuoted.videoMessage?.caption || ""; }
                if (!txtMsg && !isQuoted && !m.message.imageMessage && !m.message.videoMessage) return responder(`${pre}\n║ ⚠ Escribe un mensaje.\n${pie}`);
                
                const fch = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
                const finalTxt = `${txtMsg}\n\n| 🛡 *${groupMetadata.subject}* • ${fch}`;
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
                    } else await sock.sendMessage(chat, { text: finalTxt, mentions: menciones });
                } catch (e) { await sock.sendMessage(chat, { text: finalTxt, mentions: menciones }); }
                return;
            }

            if (comando === "kick" || comando === "sacar") {
                if (!esGrupo || !esAdmin) return;
                let target = m.message.extendedTextMessage?.contextInfo?.participant || (m.message.extendedTextMessage?.contextInfo?.mentionedJid ? m.message.extendedTextMessage.contextInfo.mentionedJid[0] : null);
                if (!target) return;
                if (target === db.creador) return responder(`${pre}\n║ ⚠️ *BLINDAJE MAESTRO*\n║ Prohibido expulsar al Creador.\n${pie}`);
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
                
                const isps = ["Telmex", "Totalplay", "Megacable", "Izzi", "Starlink"];
                const locs = ["Ecatepec", "Monterrey", "CDMX", "Guadalajara", "Culiacán"];
                const devices = ["Alcatel", "iPhone 15", "Samsung J7", "Xiaomi"];
                const secrets = ["Buscó: 'volver con mi ex'", "Debe $500", "Escucha a Bad Bunny", "Fotos vergonzosas"];
                
                const ip = `${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;
                const call = await sock.sendMessage(chat, { text: `${pre}\n║ ☠️ Rastreando IP de ${tag}...\n${pie}`, mentions: target ? [target] : [] });
                
                setTimeout(async () => {
                    await sock.sendMessage(chat, { edit: call.key, text: `╔══════════════════════════╗\n║ ☠️ *DOXEO COMPLETADO*\n╠══════════════════════════╣\n║ 👤 Objetivo: ${tag}\n║ 📡 IP: ${ip}\n║ 📍 Ciudad: ${locs[Math.floor(Math.random()*locs.length)]}\n║ 🌐 WiFi: ${isps[Math.floor(Math.random()*isps.length)]}\n║ 📱 Celular: ${devices[Math.floor(Math.random()*devices.length)]}\n║ 💳 Tarjeta: 4152 **** ${Math.floor(Math.random()*9000)+1000}\n║\n║ 🕵️‍♂️ *Secreto:*\n║ › ${secrets[Math.floor(Math.random()*secrets.length)]}\n╚══════════════════════════╝`, mentions: target ? [target] : [] });
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
                return responder(`${pre}\n║ 😏 ${piropos[Math.floor(Math.random() * piropos.length)]}\n${pie}`);
            }

            // ==========================================
            // MENÚ PRINCIPAL 100% LIMPIO PARA CLIENTES
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
║  ├ .activar - Iniciar Bot
║  ├ .activar bienvenida
║  └ .activar despedida
║
║ 🎮 ENTRETENIMIENTO
║  └ .juegos - Ver catálogo
╚══════════════════════════╝`;
                
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
