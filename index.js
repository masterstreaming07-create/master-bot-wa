const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require("express");
const QRCode = require("qrcode");

// ==========================================
// 1. SERVIDOR WEB ANTISUSPENSIÓN (RENDER)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

// URL de tu aplicación web de Google Apps Script (/exec)
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
// 3. NÚCLEO DEL BOT
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

            // --- 1. MENÚ PRINCIPAL (.menu / .help) ---
            if (comando === "menu" || comando === "help") {
                const menu = `╭───  *MASTER STREAMING*  ───╮
│  🟢 *Estado:* Online 24/7
╰────────────────────────╯

📌 *MENÚS DISPONIBLES*
 • *.menugrupo*  › Ajustes de administración
 • *.menuventas* › Planes, precios y medios de pago
 • *.menucodigos*› Extracción de códigos streaming

⚡ *ACCESOS RÁPIDOS*
 • *.codigo [correo]* › Entrega automática
 • *.pedircodigo*    › Formato manual
 • *.ping*            › Velocidad del bot

_Escribe cualquiera de los menús para ver sus opciones._`;

                await sock.sendMessage(chat, { text: menu }, { quoted: m });
            }

            // --- 2. SUBMENÚ DE GRUPO (.menugrupo) ---
            else if (comando === "menugrupo") {
                const menuGrupo = `👑 *GESTIÓN DE GRUPO*

• *.cerrar*  › Solo administradores pueden escribir
• *.abrir*   › Todos los miembros pueden escribir
• *.tagall*  › Mencionar a todos los integrantes
• *.link*    › Obtener enlace de invitación
• *.uptime*  › Tiempo que lleva el bot encendido
• *.ping*    › Latencia del servidor`;

                await sock.sendMessage(chat, { text: menuGrupo }, { quoted: m });
            }

            // --- 3. SUBMENÚ DE VENTAS (.menuventas) ---
            else if (comando === "menuventas" || comando === "precios") {
                const menuVentas = `💼 *CATÁLOGO Y SERVICIOS*

• *.precios* › Lista de tarifas por pantalla / cuenta
• *.pago*    › Cuentas bancarias y medios de pago
• *.reglas*  › Normas del grupo y garantías

_Contrataciones y renovaciones directamente con un administrador._`;

                await sock.sendMessage(chat, { text: menuVentas }, { quoted: m });
            }

            // --- 4. SUBMENÚ DE CÓDIGOS (.menucodigos) ---
            else if (comando === "menucodigos") {
                const menuCodigos = `🔑 *SISTEMA DE CÓDIGOS*

• *.codigo [correo]*
  _Busca el código en tiempo real de Disney, Netflix, Universal o Fox._

• *.pedircodigo*
  _Genera la ficha para solicitar atención manual si la plataforma no arrojó código._`;

                await sock.sendMessage(chat, { text: menuCodigos }, { quoted: m });
            }

            // --- 5. COMANDOS DE GRUPO (.cerrar, .abrir, .tagall, .link) ---
            else if (comando === "cerrar" || comando === "cerrargrupo") {
                if (!esGrupo) return;
                try {
                    await sock.groupSettingUpdate(chat, "announcement");
                    await sock.sendMessage(chat, { text: "🔒 *Grupo cerrado.* Solo administradores pueden enviar mensajes." });
                } catch (err) {
                    await sock.sendMessage(chat, { text: "❌ Error: Verifica que el bot sea administrador del grupo." });
                }
            }

            else if (comando === "abrir" || comando === "abrirgrupo") {
                if (!esGrupo) return;
                try {
                    await sock.groupSettingUpdate(chat, "not_announcement");
                    await sock.sendMessage(chat, { text: "🔓 *Grupo abierto.* Todos los miembros pueden participar." });
                } catch (err) {
                    await sock.sendMessage(chat, { text: "❌ Error: Verifica que el bot sea administrador del grupo." });
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
                    await sock.sendMessage(chat, { text: "❌ Error al obtener los miembros del grupo." });
                }
            }

            else if (comando === "link" || comando === "enlace") {
                if (!esGrupo) return;
                try {
                    const codigoInv = await sock.groupInviteCode(chat);
                    await sock.sendMessage(chat, { text: `🔗 *Enlace del grupo:* https://chat.whatsapp.com/${codigoInv}` }, { quoted: m });
                } catch (err) {
                    await sock.sendMessage(chat, { text: "❌ Error: El bot debe ser administrador para sacar el enlace." });
                }
            }

            // --- 6. UTILIDADES (.ping, .uptime) ---
            else if (comando === "ping") {
                const inicio = Date.now();
                await sock.sendMessage(chat, { text: `🏓 *¡Pong!* Latencia: ~${Date.now() - inicio}ms` }, { quoted: m });
            }

            else if (comando === "uptime") {
                const tiempo = formatearUptime(Date.now() - TIEMPO_INICIO);
                await sock.sendMessage(chat, { text: `⏱ *Tiempo activo:* \`${tiempo}\`` }, { quoted: m });
            }

            // --- 7. EXTRACCIÓN AUTOMÁTICA DE CÓDIGOS (APPS SCRIPT) ---
            else if (comando === "codigo") {
                const correo = args[0] ? args[0].trim().toLowerCase() : "";

                if (!correo || !correo.includes("@")) {
                    await sock.sendMessage(chat, { 
                        text: "⚠️ *Formato incorrecto.*\nEscribe el comando seguido del correo:\n\n_Ejemplo:_ `.codigo usuario@correo.com`" 
                    }, { quoted: m });
                    return;
                }

                await sock.sendMessage(chat, { text: `🔍 Consultando sistemas para: \`${correo}\`...` }, { quoted: m });

                try {
                    const urlConsulta = `${APPS_SCRIPT_URL}?correo=${encodeURIComponent(correo)}`;
                    const response = await fetch(urlConsulta);
                    const data = await response.json();

                    if (data && data.ok) {
                        let respuesta = `╭───  *CÓDIGO DE ACCESO*  ───╮\n` +
                                        `│ 🎬 *Servicio:* ${data.type || "Streaming"}\n` +
                                        `│ 📧 *Cuenta:* ${correo}\n` +
                                        `╰────────────────────────╯\n\n`;

                        if (data.code) {
                            respuesta += `🔑 *CÓDIGO:* \`\`\`${data.code}\`\`\`\n\n`;
                        }
                        if (data.link) {
                            respuesta += `🔗 *ENLACE DIRECTO:* \n${data.link}\n\n`;
                        }

                        respuesta += `⏰ *Válido por 15 minutos.*\n_Ingrésalo de inmediato en tu dispositivo._`;

                        await sock.sendMessage(chat, { text: respuesta }, { quoted: m });
                    } else {
                        const detalleError = data.error || "Aún no se genera un código reciente.";
                        const respuestaFallo = `❌ *Sin código disponible*\n\n` +
                                               `• *Detalle:* ${detalleError}\n` +
                                               `• *Cuenta:* \`${correo}\`\n\n` +
                                               `_Asegúrate de solicitar el código en la pantalla antes de consultar, o usa *.pedircodigo* para atención manual._`;

                        await sock.sendMessage(chat, { text: respuestaFallo }, { quoted: m });
                    }
                } catch (apiError) {
                    console.error("Error al consultar Apps Script:", apiError);
                    await sock.sendMessage(chat, { 
                        text: "⚠️ Error temporal al consultar la base de datos. Intenta nuevamente en unos segundos." 
                    }, { quoted: m });
                }
            }

            // --- 8. FORMATO MANUAL (.pedircodigo / .ficha) ---
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

            // --- 9. INFORMACIÓN COMERCIAL ---
            else if (comando === "pago" || comando === "metodos") {
                const pagos = `💳 *MÉTODOS DE PAGO DISPONIBLES*

• *Transferencia / SPEI:* Solicita CLABE por privado
• *OXXO Pay:* Disponible
• *Saldo interno:* Válido para revendedores

_Envía tu comprobante en privado una vez realizada la operación._`;
                await sock.sendMessage(chat, { text: pagos }, { quoted: m });
            }

            else if (comando === "reglas") {
                const reglas = `📜 *REGLAS DEL GRUPO*

1. Respeto mutuo entre todos los miembros.
2. Prohibido enlaces de spam o publicidad externa.
3. No alterar datos de acceso de las cuentas (correo/contraseña).
4. Usar los comandos correspondientes para agilizar la entrega.`;
                await sock.sendMessage(chat, { text: reglas }, { quoted: m });
            }

        } catch (error) {
            console.error("Error procesando mensaje:", error);
        }
    });
}

iniciarBot();
