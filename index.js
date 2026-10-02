const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require("express");
const QRCode = require("qrcode");
const fs = require("fs");

// ==========================================
// 1. BASE DE DATOS INTERNA Y SERVIDOR WEB
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwsfiLlP7ot1DSHiyLfBdXEMI_6sbt9fD0MXxynwGqPG-HDZPpTLiWffxzrFFLP5Nrl/exec";

const DB_PATH = "./auth_session/database.json";
let db = { comandos: {}, pausado: false };
if (fs.existsSync(DB_PATH)) db = JSON.parse(fs.readFileSync(DB_PATH));

function guardarDB() {
    if (!fs.existsSync('./auth_session')) fs.mkdirSync('./auth_session');
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

const TIEMPO_INICIO = Date.now();
let qrActual = null;
let botConectado = false;

app.get("/", async (req, res) => {
    if (botConectado) return res.send(`<h1 style="color: green; text-align: center; margin-top: 50px;">✅ MASTER BOT WA ACTIVO</h1>`);
    if (qrActual) {
        try {
            const qrImage = await QRCode.toDataURL(qrActual);
            return res.send(`<div style="text-align: center; margin-top: 30px;"><h2>⚡ ESCANEAR VINCULACIÓN ⚡</h2><img src="${qrImage}" style="width: 280px; border: 2px solid #333;" /><script>setTimeout(() => location.reload(), 15000);</script></div>`);
        } catch (e) { return res.send("Generando código QR..."); }
    }
    res.send("Iniciando servicio... Revisa logs en Render.");
});
app.listen(PORT, () => console.log(`Servidor web escuchando en puerto ${PORT}`));

// ==========================================
// 2. UTILIDADES
// ==========================================
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
// 3. NÚCLEO DEL BOT
// ==========================================
async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth_session");
    const sock = makeWASocket({ auth: state, logger: pino({ level: "silent" }), printQRInTerminal: true });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) { qrActual = qr; botConectado = false; }
        if (connection === "close") {
            botConectado = false;
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) iniciarBot();
        } else if (connection === "open") {
            botConectado = true; qrActual = null;
        }
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

            // --- SISTEMA DE PERMISOS ---
            let esAdmin = false;
            let soyAdmin = false;
            let groupMetadata = null;
            let participants = [];
            
            if (esGrupo) {
                groupMetadata = await sock.groupMetadata(chat);
                participants = groupMetadata.participants;
                const senderId = m.key.participant;
                const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                
                const senderObj = participants.find(p => p.id === senderId);
                esAdmin = senderObj?.admin === 'admin' || senderObj?.admin === 'superadmin';
                
                const botObj = participants.find(p => p.id === botId);
                soyAdmin = botObj?.admin === 'admin' || botObj?.admin === 'superadmin';
            }

            // --- ESTADO DEL BOT ---
            if (comando === "start" && esAdmin) { db.pausado = false; guardarDB(); return await sock.sendMessage(chat, { text: "▶️ *SISTEMA INICIADO.*" }, { quoted: m }); }
            if (comando === "stop" && esAdmin) { db.pausado = true; guardarDB(); return await sock.sendMessage(chat, { text: "⏸️ *SISTEMA EN PAUSA.*" }, { quoted: m }); }
            if (db.pausado) return;

            // ==========================================
            // MÓDULO 1: MENÚS Y SUBMENÚS
            // ==========================================
            if (comando === "menu" || comando === "help") {
                const subMenu = args[0]?.toLowerCase();
                let menuTexto = "";

                if (!subMenu) {
                    menuTexto = `╭━━━ 〈 👑 *MASTER PRO* 〉 ━━━╮\n` +
                                `┃\n` +
                                `┃ 🟢 *Estado:* Activo\n` +
                                `┃ 📅 *Fecha:* ${new Date().toLocaleDateString('es-MX')}\n` +
                                `┃\n` +
                                `┣━━ 〈 🗂️ *DIRECTORIO* 〉 ━━┫\n` +
                                `┃\n` +
                                `┃ 🛒 *.menu ventas*\n` +
                                `┃   ↳ Entregas y Pines\n` +
                                `┃\n` +
                                `┃ 🛡️ *.menu admin*\n` +
                                `┃   ↳ Moderación de Grupo\n` +
                                `┃\n` +
                                `┃ ⚙️ *.menu bot*\n` +
                                `┃   ↳ Ajustes y Sistemas\n` +
                                `┃\n` +
                                `╰━━━━━━━━━━━━━━━━━━━━━╯\n` +
                                `_Escribe un comando de arriba para ver las opciones._`;
                } 
                else if (subMenu === "ventas") {
                    menuTexto = `╭━━━ 〈 🛒 *MODO VENTAS* 〉 ━━━╮\n` +
                                `┃\n` +
                                `┃ 📌 *.codigo* [correo] [perfil]\n` +
                                `┃   ↳ Extrae la ficha del cliente.\n` +
                                `┃\n` +
                                `┃ 🔑 *.pin* [plat] [correo] [sub]\n` +
                                `┃   ↳ Extrae código OTP en vivo.\n` +
                                `┃\n` +
                                `┃ 📋 *.pedircodigo*\n` +
                                `┃   ↳ Envía plantilla en blanco.\n` +
                                `┃\n` +
                                `╰━━━━━━━━━━━━━━━━━━━━━━━╯`;
                }
                else if (subMenu === "admin") {
                    menuTexto = `╭━━━ 〈 🛡️ *MODERACIÓN* 〉 ━━━╮\n` +
                                `┃\n` +
                                `┃ 📢 *.n* [texto]\n` +
                                `┃   ↳ Anuncio global (oculto).\n` +
                                `┃\n` +
                                `┃ 🗑️ *.borrar*\n` +
                                `┃   ↳ Borra el mensaje respondido.\n` +
                                `┃\n` +
                                `┃ 👢 *.kick* [@usuario]\n` +
                                `┃   ↳ Expulsa a un miembro.\n` +
                                `┃\n` +
                                `┃ 👑 *.promover* / *.degradar*\n` +
                                `┃   ↳ Gestiona administradores.\n` +
                                `┃\n` +
                                `┃ 🔒 *.cerrar* / *.abrir*\n` +
                                `┃   ↳ Bloquea el chat del grupo.\n` +
                                `┃\n` +
                                `┃ 🔗 *.link* / *.tagall*\n` +
                                `┃   ↳ Enlace y mención masiva.\n` +
                                `┃\n` +
                                `╰━━━━━━━━━━━━━━━━━━━━━━━╯`;
                }
                else if (subMenu === "bot") {
                    menuTexto = `╭━━━ 〈 ⚙️ *SISTEMA BOT* 〉 ━━━╮\n` +
                                `┃\n` +
                                `┃ ➕ *.set* [nombre] [texto]\n` +
                                `┃   ↳ Crea un auto-respondedor.\n` +
                                `┃\n` +
                                `┃ ➖ *.del* [nombre]\n` +
                                `┃   ↳ Elimina un auto-respondedor.\n` +
                                `┃\n` +
                                `┃ ⏸️ *.stop* / *.start*\n` +
                                `┃   ↳ Detiene el bot temporalmente.\n` +
                                `┃\n` +
                                `┃ 🏓 *.ping*\n` +
                                `┃   ↳ Verifica la velocidad.\n` +
                                `┃\n` +
                                `╰━━━━━━━━━━━━━━━━━━━━━━━╯`;
                }

                let imagenUrl = "https://i.imgur.com/OFOwV0Y.jpeg";
                try {
                    const ppUrl = await sock.profilePictureUrl(sock.user.id, 'image');
                    if (ppUrl) imagenUrl = ppUrl;
                } catch (e) {}

                await sock.sendMessage(chat, { image: { url: imagenUrl }, caption: menuTexto });
                return;
            }

            // ==========================================
            // MÓDULO 2: GESTIÓN DE GRUPO PRO
            // ==========================================
            
            // 1. NOTIFICACIÓN ESTILIZADA (.n)
            if (comando === "n" || comando === "anuncio") {
                if (!esGrupo || !esAdmin) return;
                let textoMensaje = args.join(" ");
                const quotedMsg = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!textoMensaje && quotedMsg) textoMensaje = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || "";
                if (!textoMensaje) return await sock.sendMessage(chat, { text: "⚠️ Escribe un mensaje o responde a uno." });

                const menciones = participants.map(p => p.id);
                const nombreGrupo = groupMetadata.subject;
                
                const textoFinal = `📢 *COMUNICADO OFICIAL*\n━━━━━━━━━━━━━━━━━━━━\n\n*${textoMensaje}*\n\n━━━━━━━━━━━━━━━━━━━━\n🛡️ *${nombreGrupo}*`;
                await sock.sendMessage(chat, { text: textoFinal, mentions: menciones });
                return;
            }

            // 2. BORRAR MENSAJES DE OTROS (.borrar)
            if (comando === "borrar" || comando === "del") {
                if (!esGrupo || !esAdmin || !soyAdmin) return;
                const msgContext = m.message.extendedTextMessage?.contextInfo;
                if (!msgContext || !msgContext.stanzaId) return await sock.sendMessage(chat, { text: "⚠️ Responde al mensaje que deseas eliminar." }, { quoted: m });
                
                const key = { remoteJid: chat, fromMe: msgContext.participant === sock.user.id.split(':')[0] + '@s.whatsapp.net', id: msgContext.stanzaId, participant: msgContext.participant };
                await sock.sendMessage(chat, { delete: key });
                return;
            }

            // 3. EXPULSIÓN CON PROTECCIÓN (.kick)
            if (comando === "kick" || comando === "sacar") {
                if (!esGrupo || !esAdmin || !soyAdmin) return;
                let targetId = m.message.extendedTextMessage?.contextInfo?.participant || (m.message.extendedTextMessage?.contextInfo?.mentionedJid ? m.message.extendedTextMessage.contextInfo.mentionedJid[0] : null);
                if (!targetId) return await sock.sendMessage(chat, { text: "⚠️ Responde al mensaje del usuario o menciónalo." }, { quoted: m });

                // Escudo Anti-Ban: Verificar si es admin
                const targetObj = participants.find(p => p.id === targetId);
                const targetIsAdmin = targetObj?.admin === 'admin' || targetObj?.admin === 'superadmin';
                if (targetIsAdmin) return await sock.sendMessage(chat, { text: "🛡️ *PROTECCIÓN:* No puedo expulsar a un Administrador del sistema." }, { quoted: m });

                await sock.groupParticipantsUpdate(chat, [targetId], "remove");
                await sock.sendMessage(chat, { text: "👢 *Usuario eliminado del sistema.*" });
                return;
            }

            // 4. PROMOVER / DEGRADAR (Con Protección)
            if (comando === "promover" || comando === "degradar") {
                if (!esGrupo || !esAdmin || !soyAdmin) return;
                let targetId = m.message.extendedTextMessage?.contextInfo?.participant || (m.message.extendedTextMessage?.contextInfo?.mentionedJid ? m.message.extendedTextMessage.contextInfo.mentionedJid[0] : null);
                if (!targetId) return;

                if (comando === "degradar") {
                    const targetObj = participants.find(p => p.id === targetId);
                    if (targetObj?.admin === 'superadmin') return await sock.sendMessage(chat, { text: "🛡️️ *ERROR:* No puedo degradar al Creador del grupo." }, { quoted: m });
                }

                const action = comando === "promover" ? "promote" : "demote";
                await sock.groupParticipantsUpdate(chat, [targetId], action);
                await sock.sendMessage(chat, { text: comando === "promover" ? "👑 *Permisos de Administrador otorgados.*" : "⬇️ *Permisos revocados.*" });
                return;
            }

            // 5. ENLACE DEL GRUPO
            if (comando === "link" || comando === "enlace") {
                if (!esGrupo || !esAdmin || !soyAdmin) return;
                const code = await sock.groupInviteCode(chat);
                await sock.sendMessage(chat, { text: `🔗 *Enlace de Acceso:*\nhttps://chat.whatsapp.com/${code}` }, { quoted: m });
            }

            // 6. CERRAR / ABRIR GRUPO
            if (comando === "cerrar") {
                if (!esGrupo || !esAdmin || !soyAdmin) return;
                await sock.groupSettingUpdate(chat, "announcement");
                await sock.sendMessage(chat, { text: `╭━━ 🛑 *SISTEMA RESTRINGIDO* ━━╮\n┃\n┃ 🔒 *Chat cerrado* por administración.\n┃ Solo el staff puede enviar mensajes.\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━╯` });
            }
            if (comando === "abrir") {
                if (!esGrupo || !esAdmin || !soyAdmin) return;
                await sock.groupSettingUpdate(chat, "not_announcement");
                await sock.sendMessage(chat, { text: `╭━━ 🟢 *SISTEMA PÚBLICO* ━━╮\n┃\n┃ 🔓 *Chat abierto* exitosamente.\n┃ Ya pueden interactuar con normalidad.\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━╯` });
            }

            if (comando === "tagall" || comando === "todos") {
                if (!esGrupo || !esAdmin) return;
                let mensajeTag = `📢 *INVOCACIÓN GENERAL*\n\n`;
                const menciones = [];
                for (const p of participants) { menciones.push(p.id); mensajeTag += `• @${p.id.split("@")[0]}\n`; }
                await sock.sendMessage(chat, { text: mensajeTag, mentions: menciones });
            }

            // ==========================================
            // MÓDULO 3: VENTAS Y EXTRACCIÓN
            // ==========================================
            if (comando === "codigo") {
                const correo = args[0] ? args[0].trim().toLowerCase() : "";
                const perfil = args[1] ? args[1].trim().toUpperCase() : "COMPLETA";
                if (!correo || !correo.includes("@")) return await sock.sendMessage(chat, { text: `⚠ *Formato incorrecto.*\n• \`.codigo usuario@correo.com 2\`` }, { quoted: m });
                
                await sock.sendMessage(chat, { text: `📋 Verificando cuenta: \`${correo}\`...` }, { quoted: m });
                try {
                    const response = await fetch(`${APPS_SCRIPT_URL}?correo=${encodeURIComponent(correo)}&perfil=${encodeURIComponent(perfil)}`);
                    const data = await response.json();
                    if (data && data.ok) {
                        const ficha = `╭━━━ 〈 *FICHA DEL CLIENTE* 〉 ━━━╮\n┃\n┃ 🎬 *Servicio:* ${data.plataforma}\n┃ 📧 *Cuenta:* ${data.correo}\n┃ 👤 *Perfil:* ${data.perfil}\n┃ 📅 *Vence:* ${data.vence}\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n📸 *ADJUNTA LA FOTO DEL TV*\n_Envía la fotografía clara de la pantalla._`;
                        await sock.sendMessage(chat, { text: ficha }, { quoted: m });
                    } else { await sock.sendMessage(chat, { text: `❌ *No localizada*\nDetalle: ${data.error || "No existe en el inventario."}` }, { quoted: m }); }
                } catch (e) { await sock.sendMessage(chat, { text: "⚠️ Error de red." }, { quoted: m }); }
            }

            if (comando === "pin" || comando === "extraer") {
                const plataforma = args[0] ? args[0].trim().toLowerCase() : "";
                const correo = args[1] ? args[1].trim().toLowerCase() : "";
                const subtipo = args[2] ? args[2].trim().toLowerCase() : "4dig";
                if (!plataforma || !correo || !correo.includes("@")) return await sock.sendMessage(chat, { text: `⚠ *Formato incorrecto.*\nEj: \`.pin disney usuario@gmail.com\`` }, { quoted: m });
                
                await sock.sendMessage(chat, { text: `⏳ *${plataforma.toUpperCase()}* | Extrayendo código para \`${correo}\`...` }, { quoted: m });
                try {
                    const response = await fetch(`${APPS_SCRIPT_URL}?accion=extraer&plataforma=${encodeURIComponent(plataforma)}&correo=${encodeURIComponent(correo)}&subtipo=${encodeURIComponent(subtipo)}`);
                    const data = await response.json();
                    if (data && data.ok) {
                        let msgExito = `✅ *CÓDIGO OBTENIDO*\n\n📺 *Servicio:* ${data.type || plataforma.toUpperCase()}\n🔑 *Código:* *${data.code}*\n`;
                        if (data.link) msgExito += `🔗 *Enlace Hogar:* ${data.link}\n`;
                        await sock.sendMessage(chat, { text: msgExito }, { quoted: m });
                    } else { await sock.sendMessage(chat, { text: `❌ *Error:*\n${data.error || "Aún no llega."}` }, { quoted: m }); }
                } catch (e) { await sock.sendMessage(chat, { text: "⚠️ Error del servidor MasterStreaming." }, { quoted: m }); }
            }

            if (comando === "pedircodigo" || comando === "ficha") {
                await sock.sendMessage(chat, { text: `📋 *SOLICITUD DE RENOVACIÓN*\n━━━━━━━━━━━━━━━━━━━━\n\n• *Plataforma:*\n• *Correo:*\n• *Perfil:*\n\n_📌 Adjunta la foto de la pantalla._\n━━━━━━━━━━━━━━━━━━━━` }, { quoted: m });
            }

            // ==========================================
            // MÓDULO 4: COMANDOS EXTRA (.set / .del)
            // ==========================================
            if (comando === "set" && esAdmin) {
                const nombreCmd = args.shift()?.toLowerCase();
                const textoCmd = args.join(" ");
                if (!nombreCmd || !textoCmd) return;
                db.comandos[nombreCmd] = textoCmd; guardarDB();
                return await sock.sendMessage(chat, { text: `✅ Comando \`.${nombreCmd}\` guardado.` }, { quoted: m });
            }
            if (comando === "del" && esAdmin) {
                const nombreCmd = args[0]?.toLowerCase();
                if (!db.comandos[nombreCmd]) return;
                delete db.comandos[nombreCmd]; guardarDB();
                return await sock.sendMessage(chat, { text: `🗑️ Comando \`.${nombreCmd}\` eliminado.` }, { quoted: m });
            }
            if (db.comandos[comando]) {
                return await sock.sendMessage(chat, { text: db.comandos[comando] }, { quoted: m });
            }

        } catch (error) { console.error("Error procesando mensaje:", error); }
    });
}

iniciarBot();
