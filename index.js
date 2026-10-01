const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require("express");

// --- SERVIDOR WEB ANTISUSPENSION (Para Render) ---
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot Master WA Activo 24/7"));
app.listen(PORT, () => console.log(`Servidor web escuchando en puerto ${PORT}`));

const NUMERO_BOT = "56996844379";

// Agrega aquí los números de administradores (tu número personal, sin signo +)
// Si tu número personal es de México, incluye ambas variantes (con 1 y sin 1) por compatibilidad
const ADMINS = [
    "56996844379@s.whatsapp.net"
    // Ejemplo para agregar tu número personal:
    // "521777XXXXXXX@s.whatsapp.net",
    // "52777XXXXXXX@s.whatsapp.net"
];

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

    // Escuchar mensajes entrantes con extracción completa de texto
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const chat = m.key.remoteJid;
        const remitente = m.key.participant || m.key.remoteJid;

        // Extraer texto contemplando todas las variantes de Baileys
        const msg = m.message;
        const texto = (
            msg.conversation ||
            msg.extendedTextMessage?.text ||
            msg.imageMessage?.caption ||
            msg.videoMessage?.caption ||
            ""
        ).trim();

        // Registro en logs para verificar que el bot lee el chat
        if (texto.startsWith(".")) {
            console.log(`[COMANDO DETECTADO]: "${texto}" de ${remitente}`);
        } else {
            return;
        }

        const args = texto.slice(1).trim().split(/ +/);
        const comando = args.shift().toLowerCase();
        const esGrupo = chat.endsWith("@g.us");

        // --- COMANDO .cerrar ---
        if (comando === "cerrar" || comando === "cerrargrupo") {
            if (!esGrupo) {
                await sock.sendMessage(chat, { text: "⚠️ Este comando solo funciona en grupos." }, { quoted: m });
                return;
            }

            try {
                await sock.groupSettingUpdate(chat, "announcement");
                await sock.sendMessage(chat, { text: "🔒 *Grupo cerrado.* Solo administradores pueden enviar mensajes." });
            } catch (err) {
                console.error("Error al cerrar grupo:", err);
                await sock.sendMessage(chat, { text: "❌ Error: Verifica que el bot tenga permisos de administrador en el grupo." }, { quoted: m });
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
                await sock.sendMessage(chat, { text: "❌ Error: Verifica que el bot tenga permisos de administrador en el grupo." }, { quoted: m });
            }
        }

        // --- COMANDO .codigo ---
        else if (comando === "codigo") {
            const servicio = args[0] ? args[0].toUpperCase() : "GENERAL";
            await sock.sendMessage(chat, { 
                text: `🔑 *Sistema de Códigos (${servicio})*\n\nSolicitud recibida correctamente. Procesando...` 
            }, { quoted: m });
        }

        // --- COMANDO .menu O .info ---
        else if (comando === "menu" || comando === "info") {
            const menu = `🤖 *MASTER BOT WA*\n\n` +
                         `📌 *.abrir* - Abre el grupo\n` +
                         `📌 *.cerrar* - Cierra el grupo\n` +
                         `📌 *.codigo [servicio]* - Consulta de códigos\n` +
                         `📌 *.menu* - Ver este menú`;
            await sock.sendMessage(chat, { text: menu }, { quoted: m });
        }
    });
}

iniciarBot();
