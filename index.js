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

// URL de tu aplicación web de Google Apps Script (/exec)
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxhD9gsq_s9jlLV1Qafccfknuan3J3mzoIe6GzYS-KVWJNZbUiR869zhbTqJDEPD-CsOw/exec";

// Archivo local para guardar comandos personalizados y estado
const DB_PATH = "./auth_session/database.json";
let db = { comandos: {}, pausado: false };

if (fs.existsSync(DB_PATH)) {
    db = JSON.parse(fs.readFileSync(DB_PATH));
}

function guardarDB() {
    if (!fs.existsSync('./auth_session')) fs.mkdirSync('./auth_session');
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

const TIEMPO_INICIO = Date.now();
let qrActual = null;
let botConectado = false;

app.get("/", async (req, res) => {
    if (botConectado) {
        return res.send(`<h1 style="color: green; text-align: center; margin-top: 50px;">✅ MASTER BOT WA ACTIVO</h1>`);
    }
    if (qrActual) {
        try {
            const qrImage = await QRCode.toDataURL(qrActual);
            return res.send(`<div style="text-align: center; margin-top: 30px;"><h2>⚡ ESCANEAR VINCULACIÓN ⚡</h2><img src="${qrImage}" style="width: 280px; border: 2px solid #333;" /><script>setTimeout(() => location.reload(), 15000);</script></div>`);
        } catch (e) {
            return res.send("Generando código QR...");
        }
    }
    res.send("Iniciando servicio...");
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

function formatearUptime(ms) {
    const s = Math.floor((ms / 1000) % 60), m = Math.floor((ms / (1000 * 60)) % 60);
    const h = Math.floor((ms / (1000 * 60 * 60)) % 24), d = Math.floor(ms / (1000 * 60 * 60 * 24));
    return `${d}d${h}h ${m}m${s}s`;
}

// ==========================================
// 3. NÚCLEO DEL BOT
// ==========================================
async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth_session");
    const sock = makeWASocket({ auth: state, logger: pino({ level: "silent" }), printQRInTerminal: false });

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

            // --- SISTEMA DE START / STOP ---
            if (comando === "start") {
                db.pausado = false;
                guardarDB();
                await sock.sendMessage(chat, { text: "▶️ *Bot reactivado.* Escuchando comandos." }, { quoted: m });
                return;
            }
            if (comando === "stop") {
                db.pausado = true;
                guardarDB();
                await sock.sendMessage(chat, { text: "⏸️ *Bot en pausa.* No responderé hasta que uses *.start*." }, { quoted: m });
                return;
            }
            if (db.pausado) return; // Si está pausado, ignora todo lo demás

            // --- SISTEMA DE CREACIÓN DE COMANDOS (.set / .del) ---
            if (comando === "set") {
                const nombreCmd = args.shift()?.toLowerCase();
                const textoCmd = args.join(" ");
                if (!nombreCmd || !textoCmd) {
                    await sock.sendMessage(chat, { text: "⚠️ *Uso:* `.set [nombre] [texto]`\n_Ejemplo:_ `.set pago Mis cuentas son...`" }, { quoted: m });
                    return;
                }
                db.comandos[nombreCmd] = textoCmd;
                guardarDB();
                await sock.sendMessage(chat, { text: `✅ Comando personalizado \`.${nombreCmd}\` guardado con éxito.` }, { quoted: m });
                return;
            }

            if (comando === "del") {
                const nombreCmd = args[0]?.toLowerCase();
                if (!nombreCmd || !db.comandos[nombreCmd]) {
                    await sock.sendMessage(chat, { text: `⚠️ El comando \`.${nombreCmd}\` no existe.` }, { quoted: m });
                    return;
                }
                delete db.comandos[nombreCmd];
                guardarDB();
                await sock.sendMessage(chat, { text: `🗑️ Comando \`.${nombreCmd}\` eliminado.` }, { quoted: m });
                return;
            }

            // --- EJECUCIÓN DE COMANDOS PERSONALIZADOS ---
            if (db.comandos[comando]) {
                await sock.sendMessage(chat, { text: db.comandos[comando] }, { quoted: m });
                return;
            }

            // --- COMANDOS NATIVOS DEL SISTEMA ---
            if (comando === "menu" || comando === "help") {
                const menu = `╭───  *MASTER STREAMING*  ───╮\n` +
                             `│  🟢 *Estado:* Operativo 24/7\n` +
                             `╰────────────────────────╯\n\n` +
                             `⚙️ *ADMINISTRACIÓN PREMIUM*\n` +
                             ` • *.set [nombre] [texto]* › Crea comandos\n` +
                             ` • *.del [nombre]* › Borra comandos\n` +
                             ` • *.stop* / *.start* › Apaga/Enciende el bot\n\n` +
                             `🔑 *FICHAS AUTOMÁTICAS*\n` +
                             ` • *.codigo [correo] [perfil]*\n` +
                             ` • *.pedircodigo* › Formato vacío\n\n` +
                             `🛡️ *HERRAMIENTAS*\n` +
                             ` • *.cerrar* / *.abrir* › Control de grupo\n` +
                             ` • *.tagall* › Menciona a todos\n` +
                             ` • *.ping* / *.uptime*`;
                await sock.sendMessage(chat, { text: menu }, { quoted: m });
            }

            else if (comando === "cerrar" || comando === "cerrargrupo") {
                if (!esGrupo) return;
                await sock.groupSettingUpdate(chat, "announcement");
                await sock.sendMessage(chat, { text: "🔒 *Grupo cerrado.*" });
            }

            else if (comando === "abrir" || comando === "abrirgrupo") {
                if (!esGrupo) return;
                await sock.groupSettingUpdate(chat, "not_announcement");
                await sock.sendMessage(chat, { text: "🔓 *Grupo abierto.*" });
            }

            else if (comando === "tagall" || comando === "todos") {
                if (!esGrupo) return;
                const grupoMetadata = await sock.groupMetadata(chat);
                let mensajeTag = `📢 *ATENCIÓN*\n\n`;
                const menciones = [];
                for (const p of grupoMetadata.participants) {
                    menciones.push(p.id);
                    mensajeTag += `• @${p.id.split("@")[0]}\n`;
                }
                await sock.sendMessage(chat, { text: mensajeTag, mentions: menciones });
            }

            else if (comando === "ping") {
                await sock.sendMessage(chat, { text: `🏓 *Pong!* ~${Date.now() - TIEMPO_INICIO}ms` }, { quoted: m });
            }

            // --- FICHA DESDE GOOGLE SHEETS ---
            else if (comando === "codigo") {
                const correo = args[0] ? args[0].trim().toLowerCase() : "";
                const perfil = args[1] ? args[1].trim().toUpperCase() : "COMPLETA";

                if (!correo || !correo.includes("@")) {
                    await sock.sendMessage(chat, { 
                        text: `⚠️️ *Formato incorrecto.*\n\n• *Individual:* \`.codigo usuario@correo.com 2\`\n• *Completa:* \`.codigo usuario@correo.com\`` 
                    }, { quoted: m });
                    return;
                }

                await sock.sendMessage(chat, { text: `📋 Verificando cuenta: \`${correo}\`...` }, { quoted: m });

                try {
                    const urlConsulta = `${APPS_SCRIPT_URL}?correo=${encodeURIComponent(correo)}&perfil=${encodeURIComponent(perfil)}`;
                    const response = await fetch(urlConsulta);
                    const data = await response.json();

                    if (data && data.ok) {
                        const ficha = `╭───  *FICHA DE ATENCIÓN*  ───╮\n` +
                                      `│ 🎬 *Servicio:* ${data.plataforma}\n` +
                                      `│ 📧 *Cuenta:* ${data.correo}\n` +
                                      `│ 👤 *Perfil:* ${data.perfil}\n` +
                                      `│ 📅 *Vencimiento:* ${data.vence}\n` +
                                      `╰────────────────────────╯\n\n` +
                                      `📸 *ADJUNTA LA FOTO DEL TV*\n` +
                                      `_Envía la fotografía clara de la pantalla._`;
                        await sock.sendMessage(chat, { text: ficha }, { quoted: m });
                    } else {
                        await sock.sendMessage(chat, { text: `❌ *No localizada*\n\nDetalle: ${data.error || "No existe en el inventario."}` }, { quoted: m });
                    }
                } catch (apiError) {
                    await sock.sendMessage(chat, { text: "⚠️ Error temporal al conectar con la hoja de cálculo." }, { quoted: m });
                }
            }

            else if (comando === "pedircodigo" || comando === "ficha") {
                const ficha = `📋 *SOLICITUD MANUAL*\n\n━━━━━━━━━━━━━━━━━━━━\n• *Plataforma:* \n• *Correo:* \n• *Perfil:* \n• *Foto:* (Adjunta foto)\n━━━━━━━━━━━━━━━━━━━━`;
                await sock.sendMessage(chat, { text: ficha }, { quoted: m });
            }

        } catch (error) {
            console.error("Error procesando mensaje:", error);
        }
    });
}

iniciarBot();
