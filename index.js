const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const express = require("express");

// --- SERVIDOR WEB ANTISUSPENSION (Para Render) ---
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot Master WA Activo 24/7"));
app.listen(PORT, () => console.log(`Servidor web escuchando en puerto ${PORT}`));

// Pon aquí los números de administradores que pueden usar .abrir y .cerrar
// Formato sin signo '+' (ejemplo: 521XXXXXXXXXX@s.whatsapp.net)
const ADMINS = [
    "521XXXXXXXXXX@s.whatsapp.net"
];

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth_session");

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        printQRInTerminal: true
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("\n=================================");
            console.log("⚡ ESCANEA ESTE QR EN WHATSAPP ⚡");
            console.log("=================================\n");
            qrcode.generate(qr, { small: true });
        }

        if (connection === "close") {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("Conexión perdida. Reconectando...", shouldReconnect);
            if (shouldReconnect) {
                iniciarBot();
            }
        } else if (connection === "open") {
            console.log("✅ ¡BOT DE WHATSAPP CONECTADO EXITOSAMENTE!");
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
                await sock.sendMessage(chat, { text: "❌ Error: Asegúrate de que el bot sea administrador." });
            }
        }

        // .abrir
        else if (comando === "abrir" || comando === "abrirgrupo") {
            if (!esGrupo) return;
            try {
                await sock.groupSettingUpdate(chat, "not_announcement");
                await sock.sendMessage(chat, { text: "🔓 *Grupo abierto.* Todos los miembros pueden participar." });
            } catch (err) {
                await sock.sendMessage(chat, { text: "❌ Error: Asegúrate de que el bot sea administrador." });
            }
        }

        // .codigo
        else if (comando === "codigo") {
            const servicio = args[0] ? args[0].toUpperCase() : "GENERAL";
            await sock.sendMessage(chat, { 
                text: `🔑 *Entrega de Códigos (${servicio})*\n\nSolicitud en proceso...` 
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
