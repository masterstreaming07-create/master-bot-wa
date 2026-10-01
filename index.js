const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require("express");

// --- SERVIDOR WEB ANTISUSPENSION ---
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot Master WA Activo 24/7"));
app.listen(PORT, () => console.log(`Servidor web escuchando en puerto ${PORT}`));

// NÚMERO DE TELÉFONO DEL BOT (Para recibir el código de vinculación)
// Pon tu número completo con código de país SIN espacios, guiones ni signo '+'
// Ejemplo México: 521XXXXXXXXXX o 52XXXXXXXXXX
const NUMERO_BOT = "521XXXXXXXXXX"; 

// Números de administradores autorizados para .abrir y .cerrar
const ADMINS = [
    "521XXXXXXXXXX@s.whatsapp.net"
];

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth_session");

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false // Desactivamos el QR deforme
    });

    sock.ev.on("creds.update", saveCreds);

    // Si aún no está vinculado, solicitar código de emparejamiento (Pairing Code)
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(NUMERO_BOT);
                console.log("\n==========================================");
                console.log(`🔑 TU CÓDIGO DE VINCULACIÓN ES: ${code}`);
                console.log("==========================================\n");
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
            if (shouldReconnect) {
                iniciarBot();
            }
        } else if (connection === "open") {
            console.log("✅ ¡BOT DE WHATSAPP VINCULADO Y ACTIVO EXITOSAMENTE!");
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const chat = m.key.remoteJid;
        const remitente = m.key.participant || m.key.remoteJid;
        const texto = m.message.conversation || m.message.extendedTextMessage?.text || "";

        if (!texto.startsWith(".")) return;

        const args = texto.slice(1).trim().split(/ +/);
        const comando = args.shift().toLowerCase();
        const esGrupo = chat.endsWith("@g.us");

        // .cerrar
        if (comando === "cerrar" || comando === "cerrargrupo") {
            if (!esGrupo) return;
            try {
                await sock.groupSettingUpdate(chat, "announcement");
                await sock.sendMessage(chat, { text: "🔒 *Grupo cerrado.* Solo administradores pueden enviar mensajes." });
            } catch (err) {
                await sock.sendMessage(chat, { text: "❌ Error: Verifica que el bot sea admin." });
            }
        }

        // .abrir
        else if (comando === "abrir" || comando === "abrirgrupo") {
            if (!esGrupo) return;
            try {
                await sock.groupSettingUpdate(chat, "not_announcement");
                await sock.sendMessage(chat, { text: "🔓 *Grupo abierto.* Todos pueden participar." });
            } catch (err) {
                await sock.sendMessage(chat, { text: "❌ Error: Verifica que el bot sea admin." });
            }
        }

        // .codigo
        else if (comando === "codigo") {
            const servicio = args[0] ? args[0].toUpperCase() : "GENERAL";
            await sock.sendMessage(chat, { 
                text: `🔑 *Sistema de Códigos (${servicio})*\n\nSolicitud en proceso...` 
            }, { quoted: m });
        }

        // .menu o .info
        else if (comando === "menu" || comando === "info") {
            const menu = `🤖 *MASTER BOT*\n\n` +
                         `📌 *.abrir* - Abrir grupo\n` +
                         `📌 *.cerrar* - Cerrar grupo\n` +
                         `📌 *.codigo [servicio]* - Consulta de códigos`;
            await sock.sendMessage(chat, { text: menu }, { quoted: m });
        }
    });
}

iniciarBot();
