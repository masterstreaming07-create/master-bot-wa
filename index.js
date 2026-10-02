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
    if (botConectado) return res.send(`<h1 style="color: green; text-align: center; margin-top: 50px;">✅ MASTER BOT WA ACTIVO (UPTIMEROBOT CONECTADO)</h1>`);
    if (qrActual) {
        try {
            const qrImage = await QRCode.toDataURL(qrActual);
            return res.send(`<div style="text-align: center; margin-top: 30px;"><h2>⚡ ESCANEAR VINCULACIÓN ⚡</h2><img src="${qrImage}" style="width: 280px; border: 2px solid #333;" /><script>setTimeout(() => location.reload(), 15000);</script></div>`);
        } catch (e) { return res.send("Generando código QR..."); }
    }
    res.send("Iniciando servicio... Revisa los logs en Render.");
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

            // --- SISTEMA DE PERMISOS (ADMINS) ---
            let esAdmin = false;
            let soyAdmin = false;
            
            if (esGrupo) {
                const groupMetadata = await sock.groupMetadata(chat);
                const participants = groupMetadata.participants;
                const senderId = m.key.participant;
                const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                
                const senderObj = participants.find(p => p.id === senderId);
                esAdmin = senderObj?.admin === 'admin' || senderObj?.admin === 'superadmin';
                
                const botObj = participants.find(p => p.id === botId);
                soyAdmin = botObj?.admin === 'admin' || botObj?.admin === 'superadmin';
            }

            // --- ESTADO DEL BOT ---
            if (comando === "start" && esAdmin) { db.pausado = false; guardarDB(); return await sock.sendMessage(chat, { text: "▶️ *Bot reactivado.*" }, { quoted: m }); }
            if (comando === "stop" && esAdmin) { db.pausado = true; guardarDB(); return await sock.sendMessage(chat, { text: "⏸️ *Bot en pausa.*" }, { quoted: m }); }
            if (db.pausado) return;

            // ==========================================
            // MÓDULO 1: MENÚ EXTENSO (CON FOTO)
            // ==========================================
            if (comando === "menu" || comando === "help") {
                const menuTexto = `╭───  *MASTER STREAMING PRO*  ───╮\n` +
                                  `│  👑 *Suite de Automatización*\n` +
                                  `╰────────────────────────╯\n\n` +
                                  `🛒 *VENTAS Y ENTREGAS*\n` +
                                  ` • *.codigo [correo] [perfil]* › Ficha de cuenta\n` +
                                  ` • *.pin [plat] [correo]* › Extrae OTP en vivo\n` +
                                  ` • *.pedircodigo* › Plantilla de solicitud\n\n` +
                                  `👥 *GESTIÓN DE GRUPO (Admins)*\n` +
                                  ` • *.n [texto]* › Anuncio Oficial (Oculto)\n` +
                                  ` • *.kick [@user]* › Expulsar del grupo\n` +
                                  ` • *.promover [@user]* › Dar administrador\n` +
                                  ` • *.degradar [@user]* › Quitar administrador\n` +
                                  ` • *.link* › Obtener enlace de invitación\n` +
                                  ` • *.cerrar* / *.abrir* › Control de chat\n` +
                                  ` • *.tagall* › Mención visible de todos\n\n` +
                                  `⚙️ *CONFIGURACIÓN DEL SISTEMA*\n` +
                                  ` • *.set [nombre] [texto]* › Crear comando\n` +
                                  ` • *.del [nombre]* › Borrar comando\n` +
                                  ` • *.stop* / *.start* › Apagar/Encender bot`;
                
                let imagenUrl = "https://i.imgur.com/OFOwV0Y.jpeg"; // Imagen futurista de respaldo
                try {
                    // Intenta sacar la foto de perfil del propio bot
                    const ppUrl = await sock.profilePictureUrl(sock.user.id, 'image');
                    if (ppUrl) imagenUrl = ppUrl;
                } catch (e) { console.log("No se pudo obtener la foto de perfil."); }

                await sock.sendMessage(chat, { image: { url: imagenUrl }, caption: menuTexto });
                return;
            }

            // ==========================================
            // MÓDULO 2: GESTIÓN DE GRUPO (SOLO ADMINS)
            // ==========================================
            
            // 1. NOTIFICACIÓN ESTILIZADA (.n)
            if (comando === "n" || comando === "anuncio") {
                if (!esGrupo) return;
                if (!esAdmin) return await sock.sendMessage(chat, { text: "⛔ Comando reservado para administradores." }, { quoted: m });

                let textoMensaje = args.join(" ");
                const quotedMsg = m.message.extendedTextMessage?.contextInfo?.quotedMessage;

                if (!textoMensaje && quotedMsg) {
                    textoMensaje = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || "";
                }

                if (!textoMensaje) return await sock.sendMessage(chat, { text: "⚠️ Escribe un mensaje o responde a uno. Ej: `.n ¡Listos para la venta!`" }, { quoted: m });

                const groupMetadata = await sock.groupMetadata(chat);
                const menciones = groupMetadata.participants.map(p => p.id);
                
                // Formato Premium: Texto en negritas + Pie de página con fecha y nombre del grupo
                const fecha = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
                const nombreGrupo = groupMetadata.subject;
                const textoFinal = `*${textoMensaje}*\n\n| 🛡️ *${nombreGrupo}* •${fecha}`;
                
                await sock.sendMessage(chat, { text: textoFinal, mentions: menciones });
                return;
            }

            // 2. EXPULSAR USUARIOS (.kick)
            if (comando === "kick" || comando === "sacar") {
                if (!esGrupo) return;
                if (!esAdmin) return await sock.sendMessage(chat, { text: "⛔ Comando reservado para administradores." }, { quoted: m });
                if (!soyAdmin) return await sock.sendMessage(chat, { text: "❌ Necesito ser administrador del grupo para poder expulsar." }, { quoted: m });

                let target = m.message.extendedTextMessage?.contextInfo?.participant 
                          || (m.message.extendedTextMessage?.contextInfo?.mentionedJid ? m.message.extendedTextMessage.contextInfo.mentionedJid[0] : null);

                if (!target) return await sock.sendMessage(chat, { text: "⚠️ Tienes que responder al mensaje de la persona o mencionarla con @." }, { quoted: m });

                await sock.groupParticipantsUpdate(chat, [target], "remove");
                await sock.sendMessage(chat, { text: "👢 *Usuario eliminado exitosamente del sistema.*" });
                return;
            }

            // 3. PROMOVER Y DEGRADAR ADMINS
            if (comando === "promover" || comando === "degradar") {
                if (!esGrupo || !esAdmin || !soyAdmin) return;
                let target = m.message.extendedTextMessage?.contextInfo?.participant || (m.message.extendedTextMessage?.contextInfo?.mentionedJid ? m.message.extendedTextMessage.contextInfo.mentionedJid[0] : null);
                if (!target) return;

                const action = comando === "promover" ? "promote" : "demote";
                await sock.groupParticipantsUpdate(chat, [target], action);
                await sock.sendMessage(chat, { text: comando === "promover" ? "👑 *Usuario promovido a Administrador.*" : "⬇️ *Usuario degradado a miembro.*" });
                return;
            }

            // 4. ENLACE DEL GRUPO (.link)
            if (comando === "link" || comando === "enlace") {
                if (!esGrupo || !esAdmin || !soyAdmin) return;
                const code = await sock.groupInviteCode(chat);
                await sock.sendMessage(chat, { text: `🔗 *Enlace de Acceso Oficial:*\nhttps://chat.whatsapp.com/${code}` }, { quoted: m });
                return;
            }

            // 5. CERRAR / ABRIR FUTURISTA
            if (comando === "cerrar") {
                if (!esGrupo || !esAdmin || !soyAdmin) return;
                await sock.groupSettingUpdate(chat, "announcement");
                const msgCerrado = `╭─── 🛑 *SISTEMA DE SEGURIDAD* ───╮\n` +
                                   `│ 🔒 *ESTADO:* MODO RESTRINGIDO\n` +
                                   `│ 🚫 *CHAT:* CERRADO\n` +
                                   `╰───────────────────────────────╯\n` +
                                   `_El grupo ha sido bloqueado por la administración. Solo el staff puede enviar mensajes en este momento._`;
                await sock.sendMessage(chat, { text: msgCerrado });
            }
            if (comando === "abrir") {
                if (!esGrupo || !esAdmin || !soyAdmin) return;
                await sock.groupSettingUpdate(chat, "not_announcement");
                const msgAbierto = `╭─── 🟢 *SISTEMA DE SEGURIDAD* ───╮\n` +
                                   `│ 🔓 *ESTADO:* MODO PÚBLICO\n` +
                                   `│ ✅ *CHAT:* ABIERTO\n` +
                                   `╰───────────────────────────────╯\n` +
                                   `_El grupo ha sido desbloqueado. Ya pueden enviar sus mensajes y comprobantes con normalidad._`;
                await sock.sendMessage(chat, { text: msgAbierto });
            }

            // 6. TAG ALL VISIBLE
            if (comando === "tagall" || comando === "todos") {
                if (!esGrupo || !esAdmin) return;
                const grupoMetadata = await sock.groupMetadata(chat);
                let mensajeTag = `📢 *INVOCACIÓN GENERAL*\n\n`;
                const menciones = [];
                for (const p of grupoMetadata.participants) {
                    menciones.push(p.id);
                    mensajeTag += `• @${p.id.split("@")[0]}\n`;
                }
                await sock.sendMessage(chat, { text: mensajeTag, mentions: menciones });
            }

            // ==========================================
            // MÓDULO 3: VENTAS Y AUTOMATIZACIÓN
            // ==========================================

            if (comando === "codigo") {
                const correo = args[0] ? args[0].trim().toLowerCase() : "";
                const perfil = args[1] ? args[1].trim().toUpperCase() : "COMPLETA";

                if (!correo || !correo.includes("@")) {
                    await sock.sendMessage(chat, { text: `⚠ *Formato incorrecto.*\n• \`.codigo usuario@correo.com 2\`` }, { quoted: m });
                    return;
                }
                await sock.sendMessage(chat, { text: `📋 Verificando cuenta: \`${correo}\`...` }, { quoted: m });

                try {
                    const urlConsulta = `${APPS_SCRIPT_URL}?correo=${encodeURIComponent(correo)}&perfil=${encodeURIComponent(perfil)}`;
                    const response = await fetch(urlConsulta);
                    const data = await response.json();

                    if (data && data.ok) {
                        const ficha = `╭───  *FICHA DE ATENCIÓN*  ───╮\n` +
                                      `│ 🎬 *Servicio:* ${data.plataforma}\n` +                                       `│ 📧 *Cuenta:* ${data.correo}\n` +
                                      `│ 👤 *Perfil:* ${data.perfil}\n` +                                       `│ 📅 *Vencimiento:* ${data.vence}\n` +
                                      `╰────────────────────────╯\n\n` +
                                      `📸 *ADJUNTA LA FOTO DEL TV*\n` +
                                      `_Envía la fotografía clara de la pantalla._`;
                        await sock.sendMessage(chat, { text: ficha }, { quoted: m });
                    } else {
                        await sock.sendMessage(chat, { text: `❌ *No localizada*\nDetalle: ${data.error || "No existe en el inventario."}` }, { quoted: m });
                    }
                } catch (e) { await sock.sendMessage(chat, { text: "⚠️ Error de conexión con Google Sheets." }, { quoted: m }); }
            }

            if (comando === "pin" || comando === "extraer") {
                const plataforma = args[0] ? args[0].trim().toLowerCase() : "";
                const correo = args[1] ? args[1].trim().toLowerCase() : "";
                const subtipo = args[2] ? args[2].trim().toLowerCase() : "4dig";

                if (!plataforma || !correo || !correo.includes("@")) {
                    await sock.sendMessage(chat, { text: `⚠ *Formato incorrecto.*\nUso: \`.pin [plataforma] [correo]\`\nEj: \`.pin disney usuario@gmail.com\`` }, { quoted: m });
                    return;
                }

                await sock.sendMessage(chat, { text: `⏳ *${plataforma.toUpperCase()}* | Extrayendo código reciente para \`${correo}\`...` }, { quoted: m });

                try {
                    const urlExtraer = `${APPS_SCRIPT_URL}?accion=extraer&plataforma=${encodeURIComponent(plataforma)}&correo=${encodeURIComponent(correo)}&subtipo=${encodeURIComponent(subtipo)}`;
                    const response = await fetch(urlExtraer);
                    const data = await response.json();

                    if (data && data.ok) {
                        let msgExito = `✅ *CÓDIGO RECIBIDO*\n\n📺 *Servicio:* ${data.type || plataforma.toUpperCase()}\n🔑 *Código:* *${data.code}*\n`;
                        if (data.link) msgExito += `🔗 *Enlace Hogar:* ${data.link}\n`;
                        await sock.sendMessage(chat, { text: msgExito }, { quoted: m });
                    } else {
                        await sock.sendMessage(chat, { text: `❌ *Error:*\n${data.error || "Aún no llega el correo o ya caducó."}` }, { quoted: m });
                    }
                } catch (e) { await sock.sendMessage(chat, { text: "⚠️ Error al conectar con MasterStreaming." }, { quoted: m }); }
            }

            if (comando === "pedircodigo" || comando === "ficha") {
                await sock.sendMessage(chat, { text: `📋 *SOLICITUD MANUAL*\n\n━━━━━━━━━━━━━━━━━━━━\n• *Plataforma:* \n• *Correo:* \n• *Perfil:* \n• *Foto:* (Adjunta foto)\n━━━━━━━━━━━━━━━━━━━━` }, { quoted: m });
            }

            // ==========================================
            // MÓDULO 4: COMANDOS PERSONALIZADOS (.set)
            // ==========================================
            if (comando === "set" && esAdmin) {
                const nombreCmd = args.shift()?.toLowerCase();
                const textoCmd = args.join(" ");
                if (!nombreCmd || !textoCmd) return await sock.sendMessage(chat, { text: "⚠️ Uso: `.set pago Mis cuentas son...`" }, { quoted: m });
                db.comandos[nombreCmd] = textoCmd; guardarDB();
                return await sock.sendMessage(chat, { text: `✅ Comando \`.${nombreCmd}\` creado.` }, { quoted: m });
            }
            if (comando === "del" && esAdmin) {
                const nombreCmd = args[0]?.toLowerCase();
                if (!db.comandos[nombreCmd]) return await sock.sendMessage(chat, { text: `⚠️ El comando \`.${nombreCmd}\` no existe.` }, { quoted: m });
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
