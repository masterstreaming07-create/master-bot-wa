const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require("express");
const QRCode = require("qrcode");

// ==========================================
// 1. SERVIDOR WEB Y URL DE APPS SCRIPT
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

// URL de tu aplicación web de Google Apps Script
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxhD9gsq_s9jlLV1Qafccfknuan3J3mzoIe6GzYS-KVWJNZbUiR869zhbTqJDEPD-CsOw/exec";

const TIEMPO_INICIO = Date.now();
let qrActual = null;
let botConectado = false;

app.get("/", async (req, res) => {
    if (botConectado) {
        return res.send(`
            <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
                <h1 style="color: #2e7d32;">✅ MASTER BOT WA ACTIVO</h1>
                <p>El bot está vinculado y operando correctamente 24/7.</p>
            </div>
        `);
    }

    if (qrActual) {
        try {
            const qrImage = await QRCode.toDataURL(qrActual);
            return res.send(`
                <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 30px;">
                    <h2>⚡ ESCANEAR VINCULACIÓN ⚡</h2>
                    <p>WhatsApp Business > Dispositivos vinculados > Vincular un dispositivo</p>
                    <img src="${qrImage}" style="width: 280px; height: 280px; border: 2px solid #333; border-radius: 8px;" />
                    <p style="color: #666; font-size: 14px;">La imagen se actualiza automáticamente.</p>
                    <script>setTimeout(() => location.reload(), 15000);</script>
                </div>
            `);
        } catch (e) {
            return res.send("Generando código QR... Recarga en un momento.");
        }
    }

    res.send("Iniciando servicio... Recarga la página en unos segundos.");
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

    return (
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        ""
    ).trim();
}

function formatearUptime(ms) {
    const segundos = Math.floor((ms / 1000) % 60);
    const minutos = Math.floor((ms / (1000 * 60)) % 60);
    const horas = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const dias = Math.floor(ms / (1000 * 60 * 60 * 24));
    return `${dias}d${horas}h ${minutos}m${segundos}s`;
}

// ==========================================
// 3. INICIO Y ESCUCHA DEL BOT
// ==========================================
async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth_session");

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrActual = qr;
            botConectado = false;
        }

        if (connection === "close") {
            botConectado = false;
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log("Conexión cerrada. Reconectando...", shouldReconnect);
            if (shouldReconnect) iniciarBot();
        } else if (connection === "open") {
            botConectado = true;
            qrActual = null;
            console.log("✅ ¡BOT DE WHATSAPP CONECTADO Y LISTO!");
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

            console.log(`[COMANDO RECIBIDO]: "${texto}" en ${chat}`);

            const args = texto.slice(1).trim().split(/ +/);
            const comando = args.shift().toLowerCase();
            const esGrupo = chat.endsWith("@g.us");

            // --- 1. MENÚ PRINCIPAL ---
            if (comando === "menu" || comando === "help") {
                const menu = `╭───  *MASTER STREAMING*  ───╮\n` +
                             `│  🟢 *Estado:* Operativo 24/7\n` +
                             `╰────────────────────────╯\n\n` +
                             `📌 *SUBMENÚS DISPONIBLES*\n` +
                             ` • *.menugrupo*  › Administración del chat\n` +
                             ` • *.menuventas* › Tarifas y métodos de pago\n\n` +
                             `⚡ *SOLICITUD DE CÓDIGOS*\n` +
                             ` • *.codigo [correo] [perfil]*\n` +
                             `   _Genera la ficha con datos y vencimiento del Excel._\n` +
                             ` • *.ping*  › Medidor de respuesta\n\n` +
                             `_Escribe el comando directamente en el grupo._`;

                await sock.sendMessage(chat, { text: menu }, { quoted: m });
            }

            // --- 2. SUBMENÚ DE GRUPO ---
            else if (comando === "menugrupo") {
                const menuGrupo = `👑 *GESTIÓN DE GRUPO*\n\n` +
                                  `• *.cerrar*  › Solo administradores pueden escribir\n` +
                                  `• *.abrir*   › Todos los miembros pueden escribir\n` +
                                  `• *.tagall*  › Mencionar a todos en el grupo\n` +
                                  `• *.link*    › Enlace de invitación al grupo\n` +
                                  `• *.uptime*  › Tiempo en línea del bot\n` +
                                  `• *.ping*    › Latencia de respuesta`;

                await sock.sendMessage(chat, { text: menuGrupo }, { quoted: m });
            }

            // --- 3. SUBMENÚ DE VENTAS ---
            else if (comando === "menuventas" || comando === "precios") {
                const menuVentas = `💼 *SERVICIOS Y PAGOS*\n\n` +
                                   `• *.pago*   › Datos bancarios para transferencias\n` +
                                   `• *.reglas* › Normas de garantía y uso\n\n` +
                                   `_Para adquirir o renovar cuentas, envía mensaje directo a un admin._`;

                await sock.sendMessage(chat, { text: menuVentas }, { quoted: m });
            }

            // --- 4. ACCIONES DE GRUPO ---
            else if (comando === "cerrar" || comando === "cerrargrupo") {
                if (!esGrupo) return;
                try {
                    await sock.groupSettingUpdate(chat, "announcement");
                    await sock.sendMessage(chat, { text: "🔒 *Grupo cerrado.* Solo administradores pueden enviar mensajes." });
                } catch (err) {
                    await sock.sendMessage(chat, { text: "❌ Error: Asegúrate de que el bot sea administrador." });
                }
            }

            else if (comando === "abrir" || comando === "abrirgrupo") {
                if (!esGrupo) return;
                try {
                    await sock.groupSettingUpdate(chat, "not_announcement");
                    await sock.sendMessage(chat, { text: "🔓 *Grupo abierto.* Todos los miembros pueden participar." });
                } catch (err) {
                    await sock.sendMessage(chat, { text: "❌ Error: Asegúrate de que el bot sea administrador." });
                }
            }

            else if (comando === "tagall" || comando === "todos") {
                if (!esGrupo) return;
                try {
                    const grupoMetadata = await sock.groupMetadata(chat);
                    const participantes = grupoMetadata.participants;
                    let mensajeTag = `📢 *ATENCIÓN GENERAL*\n\n`;
                    const menciones = [];

                    for (const p of participantes) {
                        menciones.push(p.id);
                        mensajeTag += `• @${p.id.split("@")[0]}\n`;
                    }

                    await sock.sendMessage(chat, { text: mensajeTag, mentions: menciones });
                } catch (err) {
                    await sock.sendMessage(chat, { text: "❌ Error al obtener los miembros." });
                }
            }

            else if (comando === "link" || comando === "enlace") {
                if (!esGrupo) return;
                try {
                    const codigoInv = await sock.groupInviteCode(chat);
                    await sock.sendMessage(chat, { text: `🔗 *Enlace de invitación:* https://chat.whatsapp.com/${codigoInv}` }, { quoted: m });
                } catch (err) {
                    await sock.sendMessage(chat, { text: "❌ Error: El bot debe ser administrador." });
                }
            }

            // --- 5. UTILIDADES ---
            else if (comando === "ping") {
                const inicio = Date.now();
                await sock.sendMessage(chat, { text: `🏓 *¡Pong!* Latencia: ~${Date.now() - inicio}ms` }, { quoted: m });
            }

            else if (comando === "uptime") {
                const tiempo = formatearUptime(Date.now() - TIEMPO_INICIO);
                await sock.sendMessage(chat, { text: `⏱ *Tiempo activo:* \`${tiempo}\`` }, { quoted: m });
            }

            // --- 6. ÚNICO COMANDO DE CÓDIGO (FICHA AUTOMÁTICA DEL EXCEL) ---
            else if (comando === "codigo") {
                const correo = args[0] ? args[0].trim().toLowerCase() : "";
                const perfil = args[1] ? args[1].trim().toUpperCase() : "COMPLETA";

                if (!correo || !correo.includes("@")) {
                    await sock.sendMessage(chat, { 
                        text: `⚠️ *Formato incorrecto.*\n\n• *Para perfil:* \`.codigo correo@ejemplo.com 2\`\n• *Para completa:* \`.codigo correo@ejemplo.com\`` 
                    }, { quoted: m });
                    return;
                }

                await sock.sendMessage(chat, { text: `📋 Verificando cuenta en inventario: \`${correo}\`...` }, { quoted: m });

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
                                      `_Envía la fotografía clara de la pantalla para procesar el código._`;

                        await sock.sendMessage(chat, { text: ficha }, { quoted: m });
                    } else {
                        const errorMsg = data.error || "No encontrada en el inventario.";
                        const fallo = `❌ *Cuenta no localizada*\n\n` +
                                      `• *Detalle:* ${errorMsg}\n` +
                                      `• *Cuenta:* \`${correo}\`\n\n` +
                                      `_Comprueba que el correo coincida exactamente con la hoja de cálculo._`;

                        await sock.sendMessage(chat, { text: fallo }, { quoted: m });
                    }
                } catch (apiError) {
                    console.error("Error consultando inventario:", apiError);
                    await sock.sendMessage(chat, { 
                        text: "⚠️ Error temporal al conectar con la hoja de cálculo. Intenta de nuevo." 
                    }, { quoted: m });
                }
            }

            // --- 7. INFORMACIÓN COMERCIAL ---
            else if (comando === "pago" || comando === "metodos") {
                const pagos = `💳 *MÉTODOS DE PAGO DISPONIBLES*\n\n` +
                              `• *Transferencia / SPEI:* Solicita CLABE por privado\n` +
                              `• *OXXO Pay:* Disponible\n` +
                              `• *Saldo interno:* Válido para revendedores\n\n` +
                              `_Envía tu comprobante en privado una vez realizada la operación._`;
                await sock.sendMessage(chat, { text: pagos }, { quoted: m });
            }

            else if (comando === "reglas") {
                const reglas = `📜 *REGLAS DEL GRUPO*\n\n` +
                               `1. Respeto mutuo entre todos los miembros.\n` +
                               `2. Prohibido enlaces de spam o publicidad externa.\n` +
                               `3. No alterar datos de acceso de las cuentas (correo/contraseña).\n` +
                               `4. Solicitar códigos usando el formato correspondiente.`;
                await sock.sendMessage(chat, { text: reglas }, { quoted: m });
            }

        } catch (error) {
            console.error("Error procesando mensaje:", error);
        }
    });
}

iniciarBot();
