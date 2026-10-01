const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require("express");
const QRCode = require("qrcode");

// ==========================================
// 1. CONFIGURACIÓN Y SERVIDOR WEB (Render)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

// PEGA AQUÍ LA URL DE TU APLICACIÓN WEB DE GOOGLE APPS SCRIPT (la que termina en /exec)
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbw0TvqX35X2S7LBfVj5lUoMeY_R7abYjjBSahCI2nK98QXlPCqxtFhigG8HR7NZ6JGK/exec";

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
// 2. UTILIDADES DE MENSAJERÍA
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

            // --- COMANDO .menu / .info ---
            if (comando === "menu" || comando === "info") {
                const menu = `╭───  *MASTER STREAMING*  ───╮\n` +
                             `│  🟢 *Estado:* Online 24/7\n` +
                             `╰────────────────────────╯\n\n` +
                             `📌 *GESTIÓN DE GRUPO*\n` +
                             ` • *.cerrar*  › Cierra el chat\n` +
                             ` • *.abrir*   › Abre el chat\n` +
                             ` • *.ping*    › Estado de conexión\n\n` +
                             `🔑 *CÓDIGOS DE ACCESO*\n` +
                             ` • *.codigo [correo]* › Entrega automática\n` +
                             ` • *.pedircodigo*    › Formato manual\n\n` +
                             `_Escribe el comando directamente en el grupo._`;

                await sock.sendMessage(chat, { text: menu }, { quoted: m });
            }

            // --- COMANDO .ping ---
            else if (comando === "ping") {
                await sock.sendMessage(chat, { text: "🏓 *¡Pong!* El bot está respondiendo en tiempo real." }, { quoted: m });
            }

            // --- COMANDO .cerrar ---
            else if (comando === "cerrar" || comando === "cerrargrupo") {
                if (!esGrupo) {
                    await sock.sendMessage(chat, { text: "⚠️ Este comando solo funciona en grupos." }, { quoted: m });
                    return;
                }
                try {
                    await sock.groupSettingUpdate(chat, "announcement");
                    await sock.sendMessage(chat, { text: "🔒 *Grupo cerrado.* Solo administradores pueden enviar mensajes." });
                } catch (err) {
                    await sock.sendMessage(chat, { text: "❌ Error: Verifica que el bot sea administrador del grupo." }, { quoted: m });
                }
            }

            // --- COMANDO .abrir ---
            else if (comando === "abrir" || comando === "abrirgrupo") {
                if (!esGrupo) {
                    await sock.sendMessage(chat, { text: "⚠️ Este comando solo funciona en grupos." });
                    return;
                }
                try {
                    await sock.groupSettingUpdate(chat, "not_announcement");
                    await sock.sendMessage(chat, { text: "🔓 *Grupo abierto.* Todos los miembros pueden escribir." });
                } catch (err) {
                    await sock.sendMessage(chat, { text: "❌ Error: Verifica que el bot sea administrador del grupo." }, { quoted: m });
                }
            }

            // --- COMANDO .codigo (AUTOMÁTICO VÍA APPS SCRIPT) ---
            else if (comando === "codigo") {
                const correo = args[0] ? args[0].trim().toLowerCase() : "";

                if (!correo || !correo.includes("@")) {
                    await sock.sendMessage(chat, { 
                        text: "⚠️ *Formato incorrecto.*\nDebes escribir el comando junto al correo:\n\n_Ejemplo:_ `.codigo sidelperezoso@zohomail.com`" 
                    }, { quoted: m });
                    return;
                }

                await sock.sendMessage(chat, { text: `🔍 *Buscando código para:* \`${correo}\`...` }, { quoted: m });

                try {
                    const urlConsulta = `${APPS_SCRIPT_URL}?correo=${encodeURIComponent(correo)}`;
                    const response = await fetch(urlConsulta);
                    const data = await response.json();

                    if (data && data.encontrado) {
                        const respuestaExito = `╭───  *CÓDIGO ENCONTRADO*  ───╮\n` +
                                               `│ 🎬 *Servicio:* ${data.plataforma || "Streaming"}\n` +
                                               `│ 📧 *Cuenta:* ${correo}\n` +
                                               `╰────────────────────────╯\n\n` +
                                               `🔑 *TU CÓDIGO:* \`\`\`${data.codigo}\`\`\`\n\n` +
                                               `⏰ *Válido por 15 minutos.*\n` +
                                               `_Ingrésalo en tu pantalla de inmediato._`;

                        await sock.sendMessage(chat, { text: respuestaExito }, { quoted: m });
                    } else {
                        const respuestaFallo = `❌ *No se encontró código reciente para:* \`${correo}\`\n\n` +
                                               `• Comprueba que solicitaste el código en tu pantalla antes de consultar.\n` +
                                               `• Si el problema persiste, usa *.pedircodigo* para atención manual.`;

                        await sock.sendMessage(chat, { text: respuestaFallo }, { quoted: m });
                    }
                } catch (apiError) {
                    console.error("Error al consultar Apps Script:", apiError);
                    await sock.sendMessage(chat, { 
                        text: "⚠️ Ocurrió un error al conectar con la base de datos de correos. Intenta nuevamente en unos segundos." 
                    }, { quoted: m });
                }
            }

            // --- COMANDO .pedircodigo / .ficha (MANUAL) ---
            else if (comando === "pedircodigo" || comando === "ficha") {
                const ficha = `📋 *SOLICITUD MANUAL DE CÓDIGO*\n\n` +
                              `Copia y responde este mensaje con los datos:\n` +
                              `━━━━━━━━━━━━━━━━━━━━\n` +
                              `• *Plataforma:* \n` +
                              `• *Correo:* \n` +
                              `• *Perfil:* \n` +
                              `• *Foto:* (Adjunta foto clara del TV)\n` +
                              `━━━━━━━━━━━━━━━━━━━━\n` +
                              `_Un asesor revisará la solicitud a la brevedad._`;

                await sock.sendMessage(chat, { text: ficha }, { quoted: m });
            }

        } catch (error) {
            console.error("Error procesando mensaje:", error);
        }
    });
}

iniciarBot();
