const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require("express");

// Servidor web para mantenerlo vivo en Render
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot Master WA Activo 24/7"));
app.listen(PORT, () => console.log(`Servidor web escuchando en puerto ${PORT}`));

const NUMERO_BOT = "56996844379";

// Extraer el texto real de mensajes simples o anidados
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

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(NUMERO_BOT);
                console.log(`\n🔑 CÓDIGO: ${code}\n`);
            } catch (err) {
                console.error("Error solicitando código:", err);
            }
        }, 3000);
    }

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("Conexión cerrada. Reconectando...", shouldReconnect);
            if (shouldReconnect) iniciarBot();
        } else if (connection === "open") {
            console.log("✅ ¡BOT DE WHATSAPP CONECTADO Y LISTO!");
        }
    });

    // Escuchar mensajes entrantes
    sock.ev.on("messages.upsert", async (chatUpdate) => {
        try {
            if (!chatUpdate.messages) return;
            const m = chatUpdate.messages[0];
            if (!m.message) return;

            // Ignorar los mensajes enviados por el propio bot para no entrar en bucle
            if (m.key.fromMe) return;

            const texto = obtenerTextoMensaje(m);
            const chat = m.key.remoteJid;

            if (!texto) return;

            // Solo procesar si inicia con punto (.)
            if (!texto.startsWith(".")) return;

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
                    await sock.sendMessage(chat, { text: "⚠️ Este comando solo funciona en grupos." }, { quoted: m });
                    return;
                }
                try {
                    await sock.groupSettingUpdate(chat, "announcement");
                    await sock.sendMessage(chat, { text: "🔒 *Grupo cerrado.* Solo administradores pueden enviar mensajes." });
                } catch (err) {
                    console.error("Error al cerrar grupo:", err);
                    await sock.sendMessage(chat, { text: "❌ Error: Asegúrate de que el bot sea administrador del grupo." }, { quoted: m });
                }
            }

            // --- COMANDO .abrir ---
            else if (comando === "abrir" || comando === "abrirgrupo") {
                if (!esGrupo) {
                    await sock.sendMessage(chat, { text: "⚠️ Este comando solo funciona en grupos." }, { quoted: m });
                    return;
                }
                try {
                    await sock.groupSettingUpdate(chat, "not_announcement");
                    await sock.sendMessage(chat, { text: "🔓 *Grupo abierto.* Todos los miembros pueden participar." });
                } catch (err) {
                    console.error("Error al abrir grupo:", err);
                    await sock.sendMessage(chat, { text: "❌ Error: Asegúrate de que el bot sea administrador del grupo." }, { quoted: m });
                }
            }

            // --- COMANDO .codigo ---
            else if (comando === "codigo") {
                const servicio = args[0] ? args[0].toUpperCase() : "GENERAL";
                await sock.sendMessage(chat, { 
                    text: `🔑 *Sistema de Códigos (${servicio})*\n\nSolicitud en proceso...` 
                }, { quoted: m });
            }

        } catch (error) {
            console.error("Error procesando mensaje:", error);
        }
    });
}

iniciarBot();
