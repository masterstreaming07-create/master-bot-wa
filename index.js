const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require("express");
const QRCode = require("qrcode");

let qrActual = null;
let botConectado = false;

// --- SERVIDOR WEB CON VISOR DE QR ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", async (req, res) => {
    if (botConectado) {
        return res.send(`
            <div style="font-family: Arial; text-align: center; margin-top: 50px;">
                <h1 style="color: green;">✅ BOT CONECTADO EXITOSAMENTE</h1>
                <p>El bot está activo en WhatsApp y funcionando 24/7.</p>
            </div>
        `);
    }

    if (qrActual) {
        try {
            const qrImage = await QRCode.toDataURL(qrActual);
            return res.send(`
                <div style="font-family: Arial; text-align: center; margin-top: 40px;">
                    <h2>⚡ ESCANEA CON WHATSAPP BUSINESS ⚡</h2>
                    <p>Abre WhatsApp Business > Dispositivos vinculados > Vincular un dispositivo</p>
                    <img src="${qrImage}" style="width: 300px; height: 300px; border: 4px solid #333; border-radius: 10px;" />
                    <p style="color: gray;">La página se actualizará automáticamente si cambia el código.</p>
                    <script>setTimeout(() => location.reload(), 15000);</script>
                </div>
            `);
        } catch (e) {
            return res.send("Generando código QR... recarga en unos segundos.");
        }
    }

    res.send("Iniciando conexión con WhatsApp... recarga en 5 segundos.");
});

app.listen(PORT, () => console.log(`Servidor web escuchando en puerto ${PORT}`));

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
            console.log("⚡ Nuevo código QR generado. Disponible en la página web.");
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

            // --- COMANDO .menu ---
            if (comando === "menu" || comando === "info") {
                const menu = `🤖 *MASTER BOT WA*\n\n` +
                             `• *.abrir* : Abre el grupo\n` +
                             `• *.cerrar* : Cierra el grupo\n` +
                             `• *.codigo [servicio]* : Entrega de códigos\n` +
                             `• *.ping* : Probar estado`;
                await sock.sendMessage(chat, { text: menu }, { quoted: m });
            }

            // --- COMANDO .ping ---
            else if (comando === "ping") {
                await sock.sendMessage(chat, { text: "🏓 ¡Pong! El bot está respondiendo en tiempo real." }, { quoted: m });
            }

            // --- COMANDO .cerrar ---
            else if (comando === "cerrar" || comando === "cerrargrupo") {
                if (!esGrupo) {
                    await sock.sendMessage(chat, { text: "⚠️ Este comando solo funciona en grupos." });
                    return;
                }
                try {
                    await sock.groupSettingUpdate(chat, "announcement");
                    await sock.sendMessage(chat, { text: "🔒 *Grupo cerrado.* Solo administradores pueden enviar mensajes." });
                } catch (err) {
                    console.error("Error al cerrar grupo:", err);
                    await sock.sendMessage(chat, { text: "❌ Error: Asegúrate de que el bot sea administrador del grupo." });
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
                    await sock.sendMessage(chat, { text: "🔓 *Grupo abierto.* Todos los miembros pueden participar." });
                } catch (err) {
                    console.error("Error al abrir grupo:", err);
                    await sock.sendMessage(chat, { text: "❌ Error: Asegúrate de que el bot sea administrador del grupo." });
                }
            }

            // --- COMANDO .codigo ---
            else if (comando === "codigo") {
                const servicio = args[0] ? args[0].toUpperCase() : "GENERAL";
                await sock.sendMessage(chat, { 
                    text: `🔑 *Sistema de Códigos (${servicio})*\n\nSolicitud en proceso...` 
                });
            }

        } catch (error) {
            console.error("Error procesando mensaje:", error);
        }
    });
}

iniciarBot();
