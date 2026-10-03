const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, jidNormalizedUser } = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require("express");
const QRCode = require("qrcode");
const fs = require("fs");

// ==========================================
// 1. CONFIGURACIÓN Y SERVIDOR WEB
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
app.listen(PORT, () => console.log(`Servidor web activo en puerto ${PORT}`));

// ==========================================
// 2. UTILIDADES Y DISEÑO VISUAL (CLEAN UI)
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

// Plantilla de diseño redondeada y limpia
const pre = "╭─── 👑 *MASTER PRO* ───╮\n│";
const sep = "\n├───────────────────────\n│";
const pie = "\n╰───────────────────────╯\n";

// ==========================================
// 3. NÚCLEO Y PROCESADOR DE COMANDOS
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
            let statusCode = DisconnectReason.loggedOut;
            if (lastDisconnect && lastDisconnect.error && lastDisconnect.error.output) statusCode = lastDisconnect.error.output.statusCode;
            else if (lastDisconnect && lastDisconnect.error && lastDisconnect.error.data) statusCode = lastDisconnect.error.data.statusCode;
            
            if (statusCode !== DisconnectReason.loggedOut) setTimeout(iniciarBot, 5000);
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

            const responder = async (texto) => await sock.sendMessage(chat, { text: texto }, { quoted: m });

            let esAdmin = false;
            let groupMetadata = null;
            if (esGrupo) {
                groupMetadata = await sock.groupMetadata(chat);
                const senderId = m.key.participant;
                const senderObj = groupMetadata.participants.find(p => p.id === senderId);
                esAdmin = senderObj?.admin === 'admin' || senderObj?.admin === 'superadmin';
            }

            if (comando === "start" && esAdmin) { db.pausado = false; guardarDB(); return responder(`${pre} 🟢 *ESTADO:* ONLINE${pie}`); }
            if (comando === "stop" && esAdmin) { db.pausado = true; guardarDB(); return responder(`${pre} 🔴 *ESTADO:* OFFLINE${pie}`); }
            if (db.pausado) return;

            // ==========================================
            // MÓDULO 1: MENÚS Y SUBMENÚS
            // ==========================================
            if (comando === "menu" || comando === "help") {
                const menuTxt = `╭─── 👑 *MASTER SYSTEM* ───╮\n` +
                                `│\n` +
                                `│ 🤖 *Estado:* Operativo 24/7\n` +
                                `│ 🛡️ *Sistema:* Blindado\n` +
                                `│\n` +
                                `├────── 🗂️ DIRECTORIO ──────\n` +
                                `│\n` +
                                `│ 🛒 *.ventas*  › Cuentas y códigos\n` +
                                `│ ⚙️ *.admin*   › Gestión de Grupo\n` +
                                `│ 🎮 *.juegos*  › Entretenimiento\n` +
                                `│\n` +
                                `╰────────────────────────╯\n` +
                                `_Escribe un comando para abrir._`;
                
                // Imagen de respaldo por si falla la descarga
                let imgUrl = "https://i.imgur.com/OFOwV0Y.jpeg"; 
                
                try {
                    // Extrae el ID real del bot y busca su foto de perfil actual en WhatsApp
                    const botJid = jidNormalizedUser(sock.user.id);
                    const profilePic = await sock.profilePictureUrl(botJid, 'image');
                    if (profilePic) imgUrl = profilePic;
                } catch (e) {
                    console.log("No se pudo obtener la foto de perfil, usando respaldo.");
                }

                try {
                    await sock.sendMessage(chat, { image: { url: imgUrl }, caption: menuTxt }, { quoted: m });
                } catch(e) {
                    await sock.sendMessage(chat, { text: menuTxt }, { quoted: m }); // Fallback si todo falla
                }
                return;
            }

            if (comando === "ventas") {
                return responder(`${pre} 🛒 *MENÚ DE VENTAS*${sep} • *.codigo [correo] [perfil]*\n│ Ficha de cuenta del cliente.\n│\n│ • *.pin [plat] [correo]*\n│ Extrae el código OTP en vivo.\n│\n│ • *.pedircodigo*\n│ Plantilla manual de solicitud.${pie}`);
            }

            if (comando === "admin") {
                return responder(`${pre} ⚙️ *MODERACIÓN VIP*${sep} • *.n [texto]* › Anuncio Oficial\n│ • *.kick [@user]* › Expulsar\n│ • *.promover / .degradar*\n│ • *.cerrar / .abrir* › Chat\n│ • *.link* › Enlace del grupo\n│ • *.tagall* › Mención visible\n│\n│ *Personalización:*\n│ • *.set / .del* › Autorespuestas${pie}`);
            }

            if (comando === "juegos") {
                return responder(`${pre} 🎮 *ENTRETENIMIENTO*${sep} • *.casino* › Tragamonedas 🎰\n│ • *.dado* › Lanza los dados 🎲\n│ • *.suerte* › Medidor de suerte 🍀\n│ • *.ruleta* › Ruleta Rusa (Peligro) 🔫${pie}`);
            }

            // ==========================================
            // MÓDULO 2: JUEGOS CON ANIMACIÓN VISUAL
            // ==========================================
            if (comando === "casino" || comando === "slots") {
                const msg = await sock.sendMessage(chat, { text: `${pre} 🎰 *CASINO MASTER*${sep} Girando rodillos...\n│ [ 🌀 | 🌀 | 🌀 ]${pie}` }, { quoted: m });
                const emojis = ["🍒", "🔔", "💎", "🍋", "🍉"];
                
                setTimeout(async () => {
                    const r1 = emojis[Math.floor(Math.random() * emojis.length)];
                    const r2 = emojis[Math.floor(Math.random() * emojis.length)];
                    const r3 = emojis[Math.floor(Math.random() * emojis.length)];
                    const win = (r1 === r2 && r2 === r3) ? "¡PREMIO MAYOR! 💰💰💰" : "Sigue intentando... 📉";
                    await sock.sendMessage(chat, { edit: msg.key, text: `${pre} 🎰 *CASINO MASTER*${sep} Resultado:\n│ [ ${r1} | ${r2} | ${r3} ]\n│\n│ ${win}${pie}` });
                }, 1500);
                return;
            }

            if (comando === "dado") {
                const msg = await sock.sendMessage(chat, { text: `${pre} 🎲 *LANZAMIENTO*${sep} Agitando el dado... 🌪️${pie}` }, { quoted: m });
                setTimeout(async () => {
                    const cara = Math.floor(Math.random() * 6) + 1;
                    await sock.sendMessage(chat, { edit: msg.key, text: `${pre} 🎲 *LANZAMIENTO*${sep} El dado cayó en: *${cara}* ✅${pie}` });
                }, 1000);
                return;
            }

            if (comando === "ruleta") {
                if (!esGrupo) return;
                if (esAdmin) return responder(`${pre} 🛡️ Los Administradores no juegan a la ruleta.${pie}`);
                
                const msg = await sock.sendMessage(chat, { text: `${pre} 🔫 *RULETA RUSA*${sep} Girando el tambor... ⚙️${pie}` }, { quoted: m });
                
                setTimeout(async () => {
                    if (Math.floor(Math.random() * 6) + 1 === 1) {
                        await sock.sendMessage(chat, { edit: msg.key, text: `${pre} 🔫 *RULETA RUSA*${sep} ¡PUM! 💥 Perdiste. Adiós.${pie}` });
                        try { await sock.groupParticipantsUpdate(chat, [m.key.participant], "remove"); } catch(e) {}
                    } else {
                        await sock.sendMessage(chat, { edit: msg.key, text: `${pre} 🔫 *RULETA RUSA*${sep} Click... Te salvaste esta vez. 😅${pie}` });
                    }
                }, 2000);
                return;
            }

            if (comando === "suerte") {
                const porc = Math.floor(Math.random() * 101);
                return responder(`${pre} 🍀 *MEDIDOR DE SUERTE*${sep} Tienes un *${porc}%* de suerte.\n│ _${porc > 80 ? "¡Hoy es tu día!" : porc > 40 ? "Todo normal." : "Mejor no salgas de casa."}_${pie}`);
            }

            // ==========================================
            // MÓDULO 3: SEGURIDAD (TRY/CATCH TOTAL)
            // ==========================================
            if (comando === "cerrar" || comando === "abrir") {
                if (!esGrupo || !esAdmin) return;
                const esCerrar = comando === "cerrar";
                try {
                    await sock.groupSettingUpdate(chat, esCerrar ? "announcement" : "not_announcement");
                    const msg = `╭─── 🛡️ *SISTEMA DE SEGURIDAD* ───╮\n│\n│ 🔐 *ESTADO:* ${esCerrar ? "RESTRINGIDO" : "PÚBLICO"}\n│ 💬 *CHAT:* ${esCerrar ? "CERRADO 🔴" : "ABIERTO 🟢"}\n│\n╰─────────────────────────╯\n_${esCerrar ? "Solo el personal autorizado puede interactuar." : "Operaciones normales restauradas."}_`;
                    await sock.sendMessage(chat, { text: msg });
                } catch (error) { return responder(`${pre} ❌ *ERROR*${sep} Necesitas hacerme Administrador primero.${pie}`); }
                return;
            }

            if (comando === "n" || comando === "anuncio") {
                if (!esGrupo || !esAdmin) return responder(`${pre} ⛔ *ACCESO DENEGADO*${sep} Solo administradores.${pie}`);
                let txtMsg = args.join(" ");
                const qMsg = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!txtMsg && qMsg) txtMsg = qMsg.conversation || qMsg.extendedTextMessage?.text || "";
                if (!txtMsg) return responder(`${pre} ⚠️ *ERROR*${sep} Escribe un mensaje o responde a uno.${pie}`);
                
                const fch = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
                const finalTxt = `*${txtMsg}*\n\n| 🛡 *${groupMetadata.subject}* • ${fch}`;
                const mentions = groupMetadata.participants.map(p => p.id);
                await sock.sendMessage(chat, { text: finalTxt, mentions: mentions });
                return;
            }

            if (comando === "kick" || comando === "sacar") {
                if (!esGrupo || !esAdmin) return responder(`${pre} ⛔ Solo administradores.${pie}`);
                let target = m.message.extendedTextMessage?.contextInfo?.participant || (m.message.extendedTextMessage?.contextInfo?.mentionedJid ? m.message.extendedTextMessage.contextInfo.mentionedJid[0] : null);
                if (!target) return responder(`${pre} ⚠️ Menciona o responde al usuario.${pie}`);
                
                const targetObj = groupMetadata.participants.find(p => p.id === target);
                if (targetObj?.admin) return responder(`${pre} 🛡️ *BLINDAJE*${sep} Imposible expulsar Administración.${pie}`);

                try {
                    await sock.groupParticipantsUpdate(chat, [target], "remove");
                    return responder(`${pre} 👢 *ACCIÓN COMPLETADA*${sep} Usuario eliminado.${pie}`);
                } catch (error) { return responder(`${pre} ❌ *ERROR*${sep} Hazme administrador primero.${pie}`); }
            }

            if (comando === "promover" || comando === "degradar") {
                if (!esGrupo || !esAdmin) return;
                let target = m.message.extendedTextMessage?.contextInfo?.participant || (m.message.extendedTextMessage?.contextInfo?.mentionedJid ? m.message.extendedTextMessage.contextInfo.mentionedJid[0] : null);
                if (!target) return;
                
                if (comando === "degradar" && groupMetadata.participants.find(p => p.id === target)?.admin === 'superadmin') {
                    return responder(`${pre} 🛡️ *BLINDAJE*${sep} No se puede degradar al Creador.${pie}`);
                }

                try {
                    await sock.groupParticipantsUpdate(chat, [target], comando === "promover" ? "promote" : "demote");
                    return responder(`${pre} ⚙️ *RANGO ACTUALIZADO*${sep} Usuario ${comando === "promover" ? "Promovido 👑" : "Degradado ⬇️"}.${pie}`);
                } catch (error) { return responder(`${pre} ❌ *ERROR*${sep} Hazme administrador primero.${pie}`); }
            }

            if (comando === "link") {
                if (!esGrupo || !esAdmin) return;
                try {
                    const code = await sock.groupInviteCode(chat);
                    return responder(`${pre} 🔗 *ENLACE OFICIAL*${sep} https://chat.whatsapp.com/${code}${pie}`);
                } catch (error) { return responder(`${pre} ❌ *ERROR*${sep} Hazme administrador primero.${pie}`); }
            }

            if (comando === "tagall") {
                if (!esGrupo || !esAdmin) return;
                let msgTag = `╭─── 📢 *LLAMADO GENERAL* ───╮\n│\n`;
                const menciones = groupMetadata.participants.map(p => { msgTag += `│ • @${p.id.split("@")[0]}\n`; return p.id; });
                msgTag += `│\n╰───────────────────────╯`;
                await sock.sendMessage(chat, { text: msgTag, mentions: menciones });
                return;
            }

            // ==========================================
            // MÓDULO 4: INTEGRACIÓN MASTER STREAMING
            // ==========================================
            if (comando === "codigo") {
                const correo = args[0] ? args[0].trim().toLowerCase() : "";
                const perfil = args[1] ? args[1].trim().toUpperCase() : "COMPLETA";
                if (!correo.includes("@")) return responder(`${pre} ⚠ *ERROR DE FORMATO*${sep} Uso: .codigo usuario@correo.com${pie}`);
                
                await responder(`${pre} ⏳ Consultando base de datos...${pie}`);
                try {
                    const res = await fetch(`${APPS_SCRIPT_URL}?correo=${encodeURIComponent(correo)}&perfil=${encodeURIComponent(perfil)}`);
                    const data = await res.json();
                    if (data?.ok) {
                        const f = `╭─── 📋 *FICHA DE ATENCIÓN* ───╮\n│\n│ 🎬 *Servicio:* ${data.plataforma}\n│ 📧 *Cuenta:* ${data.correo}\n│ 👤 *Perfil:* ${data.perfil}\n│ 📅 *Vence:* ${data.vence}\n│\n├───────────────────────\n│ 📸 *FOTO REQUERIDA*\n│ _Por favor, envía la captura._\n╰───────────────────────╯`;
                        await sock.sendMessage(chat, { text: f }, { quoted: m });
                    } else { responder(`${pre} ❌ *NO ENCONTRADO*${sep} ${data.error || "No existe."}${pie}`); }
                } catch (e) { responder(`${pre} ⚠️ Error de servidor.${pie}`); }
                return;
            }

            if (comando === "pin" || comando === "extraer") {
                const plat = args[0]?.trim().toLowerCase();
                const corr = args[1]?.trim().toLowerCase();
                const sub = args[2] ? args[2].trim().toLowerCase() : "4dig";
                if (!plat || !corr?.includes("@")) return responder(`${pre} ⚠ *FORMATO*${sep} Uso: .pin [plat] [correo]${pie}`);

                await responder(`${pre} ⏳ *${plat.toUpperCase()}* | Extrayendo en vivo...${pie}`);
                try {
                    const res = await fetch(`${APPS_SCRIPT_URL}?accion=extraer&plataforma=${encodeURIComponent(plat)}&correo=${encodeURIComponent(corr)}&subtipo=${encodeURIComponent(sub)}`);
                    const data = await res.json();
                    if (data?.ok) {
                        let ok = `╭─── ✅ *CÓDIGO RECIBIDO* ───╮\n│\n│ 📺 *Servicio:* ${data.type || plat.toUpperCase()}\n│ 🔑 *Código OTP:* *${data.code}*\n`;
                        if (data.link) ok += `│ 🔗 *Hogar:* ${data.link}\n`;
                        ok += `│\n╰───────────────────────╯`;
                        await sock.sendMessage(chat, { text: ok }, { quoted: m });
                    } else { responder(`${pre} ❌ *ERROR*${sep} ${data.error || "Código caducado."}${pie}`); }
                } catch (e) { responder(`${pre} ⚠️ Error de servidor.${pie}`); }
                return;
            }

            if (comando === "pedircodigo" || comando === "ficha") {
                return responder(`╭─── 📋 *SOLICITUD MANUAL* ───╮\n│\n│ • *Plataforma:* \n│ • *Correo:* \n│ • *Perfil:* \n│ • *Foto:* (Adjuntar)\n│\n╰───────────────────────╯`);
            }

            // ==========================================
            // MÓDULO 5: COMANDOS EXTRA (.set / .del) / PING
            // ==========================================
            if (comando === "set" && esAdmin) {
                const nCmd = args.shift()?.toLowerCase();
                if (!nCmd || !args.length) return responder(`${pre} ⚠ Uso: .set [nombre] [texto]${pie}`);
                db.comandos[nCmd] = args.join(" "); guardarDB();
                return responder(`${pre} ✅ *COMANDO CREADO*${sep} Se guardó \`.${nCmd}\`${pie}`);
            }
            if (comando === "del" && esAdmin) {
                const nCmd = args[0]?.toLowerCase();
                if (!db.comandos[nCmd]) return responder(`${pre} ⚠️ El comando no existe.${pie}`);
                delete db.comandos[nCmd]; guardarDB();
                return responder(`${pre} 🗑️ *COMANDO ELIMINADO*${sep} \`.${nCmd}\` borrado.${pie}`);
            }
            if (db.comandos[comando]) return responder(`╭─── 💡 *INFORMACIÓN* ───╮\n│\n│ ${db.comandos[comando]}\n│\n╰───────────────────╯`);
            
            if (comando === "ping") {
                const latencia = Date.now() - (m.messageTimestamp * 1000);
                return responder(`╭─── 🏓 *LATENCIA* ───╮\n│\n│ 🚀 Velocidad de red:\n│ ~${latencia}ms\n│\n╰───────────────────╯`);
            }

        } catch (error) { console.error("Error procesando mensaje:", error); }
    });
}

// --- SISTEMA ANTI-CRASH ---
process.on('uncaughtException', (err) => { console.error('Error crítico no capturado:', err); });
process.on('unhandledRejection', (err) => { console.error('Promesa rechazada:', err); });

iniciarBot();
