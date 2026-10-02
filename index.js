const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
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

const TIEMPO_INICIO = Date.now();
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
// 2. UTILIDADES GLOBALES
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

function formatearUptime(ms) {
    let s = Math.floor(ms / 1000);
    let m = Math.floor(s / 60); s = s % 60;
    let h = Math.floor(m / 60); m = m % 60;
    let d = Math.floor(h / 24); h = h % 24;
    return `${d}d ${h}h ${m}m ${s}s`;
}

const pre = "╔════[ 👑 *MASTER PRO* ]════╗\n║";
const sep = "\n╠═══════════════════════╣\n║";
const pie = "\n╚═══════════════════════╝";

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
            if (lastDisconnect?.error?.output) statusCode = lastDisconnect.error.output.statusCode;
            else if (lastDisconnect?.error?.data) statusCode = lastDisconnect.error.data.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log("Reconectando en 5s...");
                setTimeout(iniciarBot, 5000);
            } else { console.log("Sesión cerrada. Escanea el QR."); }
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
            if (!texto || (!texto.startsWith(".") && !texto.startsWith("/"))) return;

            const args = texto.slice(1).trim().split(/ +/);
            const comando = args.shift().toLowerCase();
            const esGrupo = chat.endsWith("@g.us");

            // --- SISTEMA ROBUSTO DE PERMISOS (Corregido para México 52 vs 521) ---
            let esAdmin = false;
            let soyAdmin = false;
            let groupMetadata = null;
            
            if (esGrupo) {
                groupMetadata = await sock.groupMetadata(chat);
                const senderId = m.key.participant || m.key.remoteJid;
                
                // Extraemos solo los últimos 10 dígitos de tu bot para evitar el error del prefijo
                const botNumber10 = sock.user.id.split(':')[0].slice(-10); 
                
                esAdmin = groupMetadata.participants.some(p => p.id === senderId && (p.admin === 'admin' || p.admin === 'superadmin'));
                soyAdmin = groupMetadata.participants.some(p => p.id.includes(botNumber10) && (p.admin === 'admin' || p.admin === 'superadmin'));
            }

            const responder = async (txt) => { await sock.sendMessage(chat, { text: txt }, { quoted: m }); };

            // --- CONTROL GENERAL ---
            if (comando === "start" && esAdmin) { db.pausado = false; guardarDB(); return responder(`${pre} 🟢 *SISTEMA INICIADO*${pie}`); }
            if (comando === "stop" && esAdmin) { db.pausado = true; guardarDB(); return responder(`${pre} 🔴 *SISTEMA DETENIDO*${pie}`); }
            if (db.pausado) return;

            // ==========================================
            // MÓDULO 1: DIRECTORIO MULTI-MENÚ
            // ==========================================
            if (comando === "menu" || comando === "help" || comando === "opciones") {
                const imgUrl = "https://i.imgur.com/OFOwV0Y.jpeg";
                const menuTxt = `╔════[ 👑 *SUITE MASTER* ]════╗\n` +
                                `║\n` +
                                `║ 🤖 *Uptime:* ${formatearUptime(Date.now() - TIEMPO_INICIO)}\n` +
                                `║ 🛡️ *Permisos:* ${esAdmin ? "Administrador ✅" : "Usuario 👤"}\n` +
                                `║\n` +
                                `╠═════[ 🗂️ DIRECTORIO ]═════╣\n` +
                                `║\n` +
                                `║ 🛒 *.ventas*  › Cuentas y pines\n` +
                                `║ ⚙️ *.admin*   › Control de grupo\n` +
                                `║ 🎮 *.juegos*  › Entretenimiento\n` +
                                `║ 🛠️ *.tools*   › Herramientas extra\n` +
                                `║\n` +
                                `╚═══════════════════════╝\n` +
                                `_Escribe un comando para abrir esa sección._`;
                
                try {
                    const ppUrl = await sock.profilePictureUrl(sock.user.id, 'image');
                    await sock.sendMessage(chat, { image: { url: ppUrl || imgUrl }, caption: menuTxt });
                } catch (e) { await sock.sendMessage(chat, { image: { url: imgUrl }, caption: menuTxt }); }
                return;
            }

            if (comando === "ventas") {
                return responder(`${pre} 🛒 *MENÚ DE VENTAS*${sep} 📺 *.codigo [correo] [perfil]*\n║ Ficha técnica de la cuenta.\n║\n║ 🔑 *.pin [plat] [correo]*\n║ OTP. Ej: .pin disney user@g.com\n║\n║ 📝 *.pedircodigo*\n║ Solicitud manual.${pie}`);
            }

            if (comando === "admin") {
                return responder(`${pre} ⚙️ *MENÚ ADMINISTRATIVO*${sep} 📣 *.n [texto]* › Anuncio oficial\n║ 🚫 *.kick [@user]* › Expulsar\n║ 👑 *.promover / .degradar*\n║ 🔒 *.cerrar / .abrir* › Chat\n║ 🔗 *.link* › Enlace del grupo\n║ 🏷️ *.tagall* › Mención masiva\n║ ✏️ *.setname [nombre]* › Título\n║ 📝 *.setdesc [texto]* › Descrip.\n║\n║ *Comandos Personalizados:*\n║ ➕ *.set [nombre] [texto]*\n║ ➖ *.del [nombre]*${pie}`);
            }

            if (comando === "juegos") {
                return responder(`${pre} 🎮 *MENÚ ENTRETENIMIENTO*${sep} 🎲 *.dado* › Lanza un dado\n║ 🪙 *.moneda* › Cara o Cruz\n║ 🎰 *.slot* › Máquina tragamonedas\n║ 🍀 *.suerte* › Medidor de suerte\n║ ❤️ *.amor [@user]* › Compatibilidad\n║ 🏳️‍🌈 *.gay* › Medidor dudoso\n║ 🥷 *.hack [@user]* › Falsa intrusión\n║ 🎱 *.pregunta [duda]* › Bola 8 mágica\n║ ✂️ *.ppt [opción]* › Piedra/Papel/Tij\n║ 🔫 *.ruleta* › Rusa (Riesgo de kick)${pie}`);
            }

            if (comando === "tools") {
                return responder(`${pre} 🛠️ *HERRAMIENTAS*${sep} 🏓 *.ping* › Velocidad de respuesta\n║ ⏱️ *.uptime* › Tiempo activo\n║ 👨‍💻 *.dev* › Info del sistema${pie}`);
            }

            // ==========================================
            // MÓDULO 2: CONTROL ABSOLUTO DE GRUPO
            // ==========================================
            if (comando === "cerrar" || comando === "abrir") {
                if (!esGrupo) return responder(`${pre} ⚠️ Solo funciona en grupos.${pie}`);
                if (!esAdmin) return responder(`${pre} ⛔ *ACCESO DENEGADO*${sep} Requiere privilegios de Administrador.${pie}`);
                if (!soyAdmin) return responder(`${pre} ❌ *ERROR DE PERMISOS*${sep} No puedo hacerlo. Necesitas hacerme Administrador del grupo primero.${pie}`);
                
                const esCerrar = comando === "cerrar";
                await sock.groupSettingUpdate(chat, esCerrar ? "announcement" : "not_announcement");
                const msg = `╔════[ 🛡️ *SEGURIDAD* ]════╗\n` +
                            `║\n` +
                            `║ 🔐 *ESTADO:* ${esCerrar ? "RESTRINGIDO" : "PÚBLICO"}\n` +
                            `║ 💬 *CHAT:* ${esCerrar ? "CERRADO 🔴" : "ABIERTO 🟢"}\n` +
                            `║\n` +
                            `╚═══════════════════════╝`;
                return await sock.sendMessage(chat, { text: msg });
            }

            if (comando === "n" || comando === "anuncio") {
                if (!esGrupo || !esAdmin) return responder(`${pre} ⛔ Solo administradores.${pie}`);
                let txtMsg = args.join(" ");
                const qMsg = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!txtMsg && qMsg) txtMsg = qMsg.conversation || qMsg.extendedTextMessage?.text || "";
                if (!txtMsg) return responder(`${pre} ⚠️ Falta el texto del anuncio.${pie}`);
                
                const fch = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
                const finalTxt = `*${txtMsg}*\n\n| 🛡️ *${groupMetadata.subject}* • ${fch}`;
                const mentions = groupMetadata.participants.map(p => p.id);
                return await sock.sendMessage(chat, { text: finalTxt, mentions: mentions });
            }

            if (comando === "kick" || comando === "sacar") {
                if (!esGrupo || !esAdmin) return responder(`${pre} ⛔ Solo administradores.${pie}`);
                if (!soyAdmin) return responder(`${pre} ❌ Hazme administrador primero.${pie}`);
                let target = m.message.extendedTextMessage?.contextInfo?.participant || (m.message.extendedTextMessage?.contextInfo?.mentionedJid ? m.message.extendedTextMessage.contextInfo.mentionedJid[0] : null);
                if (!target) return responder(`${pre} ⚠️ Responde al mensaje del usuario o menciónalo con @.${pie}`);
                
                const targetObj = groupMetadata.participants.find(p => p.id === target);
                if (targetObj?.admin) return responder(`${pre} 🛡️ *BLINDAJE ACTIVO*${sep} Imposible expulsar a otro Administrador.${pie}`);

                await sock.groupParticipantsUpdate(chat, [target], "remove");
                return responder(`${pre} 👢 *EXPULSIÓN EXITOSA*${sep} El usuario fue removido.${pie}`);
            }

            if (comando === "promover" || comando === "degradar") {
                if (!esGrupo || !esAdmin) return;
                if (!soyAdmin) return responder(`${pre} ❌ Hazme administrador primero.${pie}`);
                let target = m.message.extendedTextMessage?.contextInfo?.participant || (m.message.extendedTextMessage?.contextInfo?.mentionedJid ? m.message.extendedTextMessage.contextInfo.mentionedJid[0] : null);
                if (!target) return responder(`${pre} ⚠️ Responde al mensaje del usuario o menciónalo con @.${pie}`);
                
                if (comando === "degradar") {
                    const targetObj = groupMetadata.participants.find(p => p.id === target);
                    if (targetObj?.admin === 'superadmin') return responder(`${pre} 🛡️ *BLINDAJE ACTIVO*${sep} No puedes degradar al creador del grupo.${pie}`);
                }
                await sock.groupParticipantsUpdate(chat, [target], comando === "promover" ? "promote" : "demote");
                return responder(`${pre} ⚙️ *RANGO ACTUALIZADO*${sep} Acción: ${comando.toUpperCase()} completada.${pie}`);
            }

            if (comando === "link") {
                if (!esGrupo || !esAdmin) return;
                if (!soyAdmin) return responder(`${pre} ❌ Hazme administrador primero.${pie}`);
                const code = await sock.groupInviteCode(chat);
                return responder(`${pre} 🔗 *ENLACE DE INVITACIÓN*${sep} https://chat.whatsapp.com/${code}${pie}`);
            }

            if (comando === "setname" || comando === "setdesc") {
                if (!esGrupo || !esAdmin) return;
                if (!soyAdmin) return responder(`${pre} ❌ Hazme administrador primero.${pie}`);
                const texto = args.join(" ");
                if (!texto) return responder(`${pre} ⚠️ Falta el texto.${pie}`);
                
                if (comando === "setname") await sock.groupUpdateSubject(chat, texto);
                else await sock.groupUpdateDescription(chat, texto);
                return responder(`${pre} ✅ *GRUPO ACTUALIZADO*${pie}`);
            }

            if (comando === "tagall" || comando === "todos") {
                if (!esGrupo || !esAdmin) return;
                let msgTag = `╔════[ 📢 *LLAMADO A TODOS* ]════╗\n║\n`;
                const menciones = groupMetadata.participants.map(p => {
                    msgTag += `║ • @${p.id.split("@")[0]}\n`;
                    return p.id;
                });
                msgTag += `║\n╚═══════════════════════╝`;
                return await sock.sendMessage(chat, { text: msgTag, mentions: menciones });
            }

            // ==========================================
            // MÓDULO 3: VENTAS Y EXTRACCIÓN (SHEETS)
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
                        const f = `╔════[ 📋 *FICHA DE CLIENTE* ]════╗\n║\n║ 🎬 *Servicio:* ${data.plataforma}\n║ 📧 *Cuenta:* ${data.correo}\n║ 👤 *Perfil:* ${data.perfil}\n║ 📅 *Vence:* ${data.vence}\n║\n╠═══════════════════════╣\n║ 📸 *FOTO REQUERIDA*\n║ _Por favor, envía la captura._\n╚═══════════════════════╝`;
                        await sock.sendMessage(chat, { text: f }, { quoted: m });
                    } else { responder(`${pre} ❌ *NO ENCONTRADO*${sep} ${data.error || "No existe en el inventario."}${pie}`); }
                } catch (e) { responder(`${pre} ⚠️ Error de servidor.${pie}`); }
                return;
            }

            if (comando === "pin" || comando === "extraer") {
                const plat = args[0]?.trim().toLowerCase();
                const corr = args[1]?.trim().toLowerCase();
                const sub = args[2] ? args[2].trim().toLowerCase() : "4dig";
                if (!plat || !corr?.includes("@")) return responder(`${pre} ⚠ *ERROR DE FORMATO*${sep} Uso: .pin [plat] [correo]${pie}`);

                await responder(`${pre} ⏳ *${plat.toUpperCase()}* | Extrayendo en vivo...${pie}`);
                try {
                    const res = await fetch(`${APPS_SCRIPT_URL}?accion=extraer&plataforma=${encodeURIComponent(plat)}&correo=${encodeURIComponent(corr)}&subtipo=${encodeURIComponent(sub)}`);
                    const data = await res.json();
                    if (data?.ok) {
                        let ok = `╔════[ ✅ *CÓDIGO RECIBIDO* ]════╗\n║\n║ 📺 *Servicio:* ${data.type || plat.toUpperCase()}\n║ 🔑 *OTP:* *${data.code}*\n`;
                        if (data.link) ok += `║ 🔗 *Hogar:* ${data.link}\n`;
                        ok += `║\n╚═══════════════════════╝`;
                        await sock.sendMessage(chat, { text: ok }, { quoted: m });
                    } else { responder(`${pre} ❌ *ERROR DE EXTRACCIÓN*${sep} ${data.error || "Código caducado o no recibido."}${pie}`); }
                } catch (e) { responder(`${pre} ⚠️ Error de servidor.${pie}`); }
                return;
            }

            if (comando === "pedircodigo") {
                return responder(`╔════[ 📋 *SOLICITUD MANUAL* ]════╗\n║\n║ • *Plataforma:* \n║ • *Correo:* \n║ • *Perfil:* \n║ • *Foto:* (Adjuntar)\n║\n╚═══════════════════════╝`);
            }

            // ==========================================
            // MÓDULO 4: ENTRETENIMIENTO Y JUEGOS
            // ==========================================
            if (comando === "dado") {
                return responder(`${pre} 🎲 *LANZAMIENTO*${sep} Cayó en: *${Math.floor(Math.random() * 6) + 1}*${pie}`);
            }
            if (comando === "moneda") {
                return responder(`${pre} 🪙 *CARA O CRUZ*${sep} Cayó en: *${Math.random() < 0.5 ? "ÁGUILA 🦅" : "SOL ☀️"}*${pie}`);
            }
            if (comando === "suerte") {
                const p = Math.floor(Math.random() * 101);
                return responder(`${pre} 🍀 *SUERTE*${sep} Tienes *${p}%* de suerte hoy.${pie}`);
            }
            if (comando === "amor") {
                const obj = args[0] || "esa persona";
                return responder(`${pre} ❤️ *COMPATIBILIDAD*${sep} Tienes *${Math.floor(Math.random() * 101)}%* de amor con ${obj}.${pie}`);
            }
            if (comando === "gay") {
                return responder(`${pre} 🏳️‍🌈 *TEST DE DUDAS*${sep} Eres *${Math.floor(Math.random() * 101)}%* gay. Confirmado.${pie}`);
            }
            if (comando === "pregunta") {
                const res = ["Sí, definitivamente.", "No cuentes con ello.", "Tal vez...", "Mis fuentes dicen que no.", "Es muy probable.", "Mejor no te digo."];
                return responder(`${pre} 🎱 *BOLA MÁGICA*${sep} ${res[Math.floor(Math.random() * res.length)]}${pie}`);
            }
            if (comando === "slot") {
                const frutas = ["🍒", "🍋", "🍉", "🍇", "🔔", "💎"];
                const r1 = frutas[Math.floor(Math.random() * 6)];
                const r2 = frutas[Math.floor(Math.random() * 6)];
                const r3 = frutas[Math.floor(Math.random() * 6)];
                const gana = (r1 === r2 && r2 === r3);
                return responder(`${pre} 🎰 *TRAGAMONEDAS*${sep} [ ${r1} | ${r2} | ${r3} ]\n║\n║ ${gana ? "¡PREMIO MAYOR! 🎉" : "Perdiste todo. 💸"}${pie}`);
            }
            if (comando === "hack") {
                const user = args[0] || "Objetivo";
                return responder(`*Iniciando protocolo de intrusión en ${user}...*\n[||||||||||||||||] 100%\n- Extrayendo contraseñas...\n- Revisando historial de Chrome...\n- Enviando historial a su mamá...\n*Hackeo completado con éxito 😈*`);
            }
            if (comando === "ppt") {
                const botOp = ["piedra", "papel", "tijera"][Math.floor(Math.random() * 3)];
                const userOp = args[0]?.toLowerCase();
                if (!["piedra", "papel", "tijera"].includes(userOp)) return responder(`${pre} ⚠️ Uso: .ppt [piedra/papel/tijera]${pie}`);
                let res = "EMPATE 🤝";
                if ((userOp==="piedra"&&botOp==="tijera")||(userOp==="papel"&&botOp==="piedra")||(userOp==="tijera"&&botOp==="papel")) res = "¡GANASTE! 🎉";
                else if (userOp !== botOp) res = "PERDISTE 💀";
                return responder(`${pre} 🎮 *VS*${sep} Tú: ${userOp}\n║ Bot: ${botOp}\n║\n║ *${res}*${pie}`);
            }
            if (comando === "ruleta") {
                if (!esGrupo) return;
                if (!soyAdmin) return responder(`${pre} ❌ Necesito ser Admin para jugar a la ruleta.${pie}`);
                if (esAdmin) return responder(`${pre} 🛡️ Los Administradores tienen inmunidad. No juegan.${pie}`);
                if (Math.floor(Math.random() * 6) + 1 === 1) {
                    await responder(`${pre} 🔫 *PUM!*${sep} Estás muerto. Adiós.${pie}`);
                    await sock.groupParticipantsUpdate(chat, [m.key.participant], "remove");
                } else { return responder(`${pre} 🔫 *CLICK...*${sep} Te salvaste.${pie}`); }
            }

            // ==========================================
            // MÓDULO 5: COMANDOS EXTRA Y HERRAMIENTAS
            // ==========================================
            if (comando === "set" && esAdmin) {
                const nCmd = args.shift()?.toLowerCase();
                if (!nCmd || !args.length) return responder(`${pre} ⚠️ Uso: .set [nombre] [texto]${pie}`);
                db.comandos[nCmd] = args.join(" "); guardarDB();
                return responder(`${pre} ✅ *COMANDO AÑADIDO*${sep} \`.${nCmd}\`${pie}`);
            }
            if (comando === "del" && esAdmin) {
                const nCmd = args[0]?.toLowerCase();
                if (!db.comandos[nCmd]) return responder(`${pre} ⚠️ No existe.${pie}`);
                delete db.comandos[nCmd]; guardarDB();
                return responder(`${pre} 🗑️ *COMANDO ELIMINADO*${pie}`);
            }
            if (db.comandos[comando]) return responder(`╔════[ 💡 *INFO* ]════╗\n║\n║ ${db.comandos[comando]}\n║\n╚═══════════════════════╝`);
            
            if (comando === "ping") return responder(`${pre} 🏓 *PONG*${sep} Latencia: ~${Date.now() - TIEMPO_INICIO}ms${pie}`);
            if (comando === "uptime") return responder(`${pre} ⏱️ *UPTIME*${sep} ${formatearUptime(Date.now() - TIEMPO_INICIO)}${pie}`);
            if (comando === "dev") return responder(`${pre} 👨‍💻 *MASTER SYSTEM*${sep} Base: Node.js/Baileys\n║ Host: Render Cloud\n║ Motor: Apps Script${pie}`);

        } catch (error) { console.error("Error procesando mensaje:", error); }
    });
}

// --- ANTI-CRASH SYSTEM ---
process.on('uncaughtException', (err) => console.log('Error no capturado:', err));
process.on('unhandledRejection', (err) => console.log('Promesa rechazada:', err));

iniciarBot();
