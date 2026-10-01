const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require("express");
const QRCode = require("qrcode");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// --- SERVIDOR WEB ANTISUSPENSIÓN Y VISOR QR ---
const app = express();
const PORT = process.env.PORT || 3000;
let qrActual = null;
let botConectado = false;

// URL DE TU IMPLEMENTACIÓN EN GOOGLE APPS SCRIPT
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbw0TvqX35X2S7LBfVj5lUoMeY_R7abYjjBSahCI2nK98QXlPCqxtFhigG8HR7NZ6JGK/exec";

app.get("/", async (req, res) => {
    if (botConectado) {
        return res.send(`
            <div style="font-family: Arial; text-align: center; margin-top: 50px; background: #0b0c10; color: #66fcf1; padding: 40px; border-radius: 15px;">
                <h1>⚡ 𝐌𝐀𝐒𝐓𝐄𝐑 𝐒𝐓𝐑𝐄𝐀𝐌𝐈𝐍𝐆 𝐁𝐎𝐓 ⚡</h1>
                <p style="color: #45a29e;">Servidor Activo 24/7 en la Nube</p>
            </div>
        `);
    }
    if (qrActual) {
        try {
            const qrImage = await QRCode.toDataURL(qrActual);
            return res.send(`
                <div style="font-family: Arial; text-align: center; margin-top: 30px; background: #0b0c10; color: #fff; padding: 20px;">
                    <h2 style="color: #ff0055;">⚡ VINCULA TU WHATSAPP BUSINESS ⚡</h2>
                    <img src="${qrImage}" style="width: 280px; height: 280px; border: 4px solid #66fcf1; border-radius: 12px;" />
                    <script>setTimeout(() => location.reload(), 15000);</script>
                </div>
            `);
        } catch (e) {
            return res.send("Generando código QR...");
        }
    }
    res.send("Iniciando servicios de MasterStreaming...");
});

app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));

// --- BASE DE DATOS LOCAL JSON ---
const DB_PATH = path.join(__dirname, "comandos_ventas.json");
const USERS_PATH = path.join(__dirname, "usuarios_economia.json");

function leerDatos(archivo, defecto = {}) {
    try {
        if (!fs.existsSync(archivo)) fs.writeFileSync(archivo, JSON.stringify(defecto, null, 2));
        return JSON.parse(fs.readFileSync(archivo, "utf-8"));
    } catch {
        return defecto;
    }
}

function guardarDatos(archivo, datos) {
    fs.writeFileSync(archivo, JSON.stringify(datos, null, 2));
}

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
        }
        if (connection === "close") {
            botConectado = false;
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) iniciarBot();
        } else if (connection === "open") {
            botConectado = true;
            qrActual = null;
            console.log("⚡ ¡MASTER STREAMING BOT OPERATIVO!");
        }
    });

    sock.ev.on("messages.upsert", async (chatUpdate) => {
        try {
            if (!chatUpdate.messages) return;
            const m = chatUpdate.messages[0];
            if (!m.message || m.key.fromMe) return;

            const texto = obtenerTextoMensaje(m);
            const chat = m.key.remoteJid;
            const remitente = m.key.participant || m.key.remoteJid;

            if (!texto.startsWith(".")) return;

            const partes = texto.slice(1).trim().split(/ +/);
            const comando = partes[0].toLowerCase();
            const argumento = texto.slice(comando.length + 2).trim();
            const esGrupo = chat.endsWith("@g.us");

            const plantillas = leerDatos(DB_PATH);
            const economia = leerDatos(USERS_PATH);

            // ==========================================
            // ⚡ SISTEMA DINÁMICO .set (VENTAS / STOCK)
            // ==========================================
            if (comando.startsWith("set")) {
                const subComando = comando.slice(3);
                if (!subComando) {
                    await sock.sendMessage(chat, { 
                        text: `⚠️ *USO DEL COMANDO:* \`.set[nombre] [mensaje]\`\n\n_Ejemplo:_ \`.setpago Datos de transferencia BBVA, OXXO...\`` 
                    }, { quoted: m });
                    return;
                }
                if (!argumento) {
                    await sock.sendMessage(chat, { text: `⚠️ *Ingresa el texto que se guardará en* \`.${subComando}\`` }, { quoted: m });
                    return;
                }

                plantillas[subComando] = argumento;
                guardarDatos(DB_PATH, plantillas);
                await sock.sendMessage(chat, { 
                    text: `⚡ *CONFIGURACIÓN EXITOSA* ⚡\n\nEl comando \`.${subComando}\` quedó actualizado correctamente.` 
                }, { quoted: m });
                return;
            }

            if (plantillas[comando]) {
                await sock.sendMessage(chat, { text: plantillas[comando] }, { quoted: m });
                return;
            }

            // ==========================================
            // 🔑 CONSULTA DIRECTA AL GOOGLE SHEETS (.codigo / .cuenta)
            // ==========================================
            if (comando === "codigo" || comando === "cuenta" || comando === "cod") {
                if (!argumento) {
                    await sock.sendMessage(chat, { 
                        text: `⚠️ *Debes ingresar el correo a consultar.*\n\n_Ejemplo:_ \`.codigo sidelperezoso@zohomail.com\`` 
                    }, { quoted: m });
                    return;
                }

                await sock.sendMessage(chat, { text: `🔍 *Consultando base de datos para:* \`${argumento}\`...` }, { quoted: m });

                try {
                    const res = await axios.get(`${SCRIPT_URL}?correo=${encodeURIComponent(argumento)}`, { timeout: 15000 });
                    const datos = res.data;

                    if (datos.status === "success") {
                        const respuestaExito = `🌌 ══════════════════════ 🌌\n` +
                                               `   ⚡ *DATOS DE CUENTA MASTER* ⚡\n` +
                                               `🌌 ══════════════════════ 🌌\n\n` +
                                               `📺 *Plataforma:* ${datos.plataforma}\n` +
                                               `📧 *Correo:* ${datos.correo}\n` +
                                               `📦 *Tipo:* ${datos.tipoVenta}\n` +
                                               `📅 *Vence:* ${datos.vence}\n` +
                                               `🔑 *Pines Asignados:* ${datos.pines}\n\n` +
                                               `⚡ ══════════════════════ ⚡`;
                        await sock.sendMessage(chat, { text: respuestaExito }, { quoted: m });
                    } else {
                        await sock.sendMessage(chat, { 
                            text: `❌ *No encontrado:* ${datos.mensaje || "El correo no está registrado en el inventario."}` 
                        }, { quoted: m });
                    }
                } catch (err) {
                    console.error("Error al consultar Apps Script:", err.message);
                    await sock.sendMessage(chat, { 
                        text: `❌ *Error al conectar con la hoja de cálculo.* Verifica que la Web App esté implementada correctamente.` 
                    }, { quoted: m });
                }
            }

            // ==========================================
            // 🚀 FICHA Y PEDIDO DE CÓDIGOS MASTER
            // ==========================================
            else if (comando === "pedircodigo" || comando === "ficha" || comando === "formato") {
                const ficha = `🌌 ══════════════════════ 🌌\n` +
                              `     ⚡ *CÓDIGOS MASTER STREAMING* ⚡\n` +
                              `🌌 ══════════════════════ 🌌\n\n` +
                              `⚠️ *REGLA IMPORTANTE:* Antes de llenar la ficha, pregunta en el chat si hay atención activa para códigos.\n\n` +
                              `📋 *COPIA Y RELLENA ESTE FORMATO:* 👇\n\n` +
                              `*FICHA DE SOLICITUD DE ACCESO*\n` +
                              `🎮 *PLATAFORMA:* \n` +
                              `📧 *CORREO:* \n` +
                              `👤 *PERFIL:* (Nombre del perfil o "Cuenta Completa")\n` +
                              `📅 *FECHA DE COMPRA:* \n` +
                              `📸 *FOTO DEL CÓDIGO:* (Adjuntar captura clara de pantalla del televisor o dispositivo)\n\n` +
                              `⚡ ══════════════════════ ⚡\n` +
                              `_En breve un administrador o el sistema procesará tu solicitud._`;

                await sock.sendMessage(chat, { text: ficha }, { quoted: m });
            }

            // ==========================================
            // 🌌 MENÚ PRINCIPAL INTERACTIVO
            // ==========================================
            else if (comando === "menu") {
                const menuGeneral = `⚡ ══════════════════════ ⚡\n` +
                                    `   🪐 *𝐌𝐀𝐒𝐓𝐄𝐑 𝐒𝐓𝐑𝐄𝐀𝐌𝐈𝐍𝐆 𝐁𝐎𝐓* 🪐\n` +
                                    `⚡ ══════════════════════ ⚡\n` +
                                    `│ 🚀 *Estado:* Online 24/7\n` +
                                    `│ 🌐 *Servidor:* En la Nube\n` +
                                    `╰─────────────────────────➤\n\n` +
                                    `⚡ *MENÚS DEL SISTEMA* ⚡\n` +
                                    `╭───────────────❖\n` +
                                    `│ 👑 *.menugrupo*  ➟ Control de grupo\n` +
                                    `│ 💎 *.menuventas* ➟ Catálogo y stock\n` +
                                    `│ 🔑 *.codigo [correo]* ➟ Consultar cuenta en Excel\n` +
                                    `│ 📋 *.pedircodigo* ➟ Formato para solicitar códigos\n` +
                                    `│ 🎮 *.menufree*   ➟ Juegos y diversión\n` +
                                    `╰───────────────❖\n\n` +
                                    `✨ _Para personalizar comandos usa \`.set[nombre] [texto]\`_`;
                await sock.sendMessage(chat, { text: menuGeneral }, { quoted: m });
            }

            // ==========================================
            // 👑 SUBMENÚ DE ADMINISTRACIÓN
            // ==========================================
            else if (comando === "menugrupo") {
                const menuGrupo = `👑 ══════════════════════ 👑\n` +
                                  `    ⚡ *GESTIÓN DE GRUPOS* ⚡\n` +
                                  `👑 ══════════════════════ 👑\n\n` +
                                  `🔒 *.cerrar*  ➟ Cierra el grupo (Solo Admins)\n` +
                                  `🔓 *.abrir*   ➟ Abre el grupo para todos\n` +
                                  `📢 *.tagall*  ➟ Menciona a todos los miembros\n` +
                                  `🏓 *.ping*    ➟ Medidor de latencia en vivo`;
                await sock.sendMessage(chat, { text: menuGrupo }, { quoted: m });
            }

            // ==========================================
            // 💎 SUBMENÚ DE VENTAS
            // ==========================================
            else if (comando === "menuventas") {
                const guardados = Object.keys(plantillas);
                const lista = guardados.length > 0 
                    ? guardados.map(c => `│ ⚡ *.${c}*`).join("\n")
                    : "│ ⚡ _No hay comandos configurados aún_";

                const menuVentas = `💎 ══════════════════════ 💎\n` +
                                   `   ⚡ *CATÁLOGO DE VENTAS* ⚡\n` +
                                   `💎 ══════════════════════ 💎\n\n` +
                                   `╭───────────────❖\n` +
                                   `${lista}\n` +
                                   `╰───────────────❖\n\n` +
                                   `💡 *Configurar comandos rápidos:*\n` +
                                   `Usa: \`.set[nombre] [texto]\`\n` +
                                   `_Ejemplo:_ \`.setstock Cuentas disponibles hoy...\``;
                await sock.sendMessage(chat, { text: menuVentas }, { quoted: m });
            }

            // ==========================================
            // 🎮 SUBMENÚ DE JUEGOS Y SOCIAL
            // ==========================================
            else if (comando === "menufree") {
                const menuJuegos = `🎮 ══════════════════════ 🎮\n` +
                                   `    ⚡ *ZONA DE ENTRETENIMIENTO* ⚡\n` +
                                   `🎮 ══════════════════════ 🎮\n\n` +
                                   `│ 💼 *.work*   ➟ Gana monedas virtuales\n` +
                                   `│ 💰 *.money*  ➟ Consulta tu billetera\n` +
                                   `│ 📡 *.doxeo*  ➟ Simulación de rastreo cibernético\n` +
                                   `│ 💘 *.ship*   ➟ Calcula compatibilidad de pareja\n` +
                                   `│ ✨ *.piropo* ➟ Envía una frase al azar`;
                await sock.sendMessage(chat, { text: menuJuegos }, { quoted: m });
            }

            // ==========================================
            // ⚡ ACCIONES DE GRUPO
            // ==========================================
            else if (comando === "cerrar" || comando === "cerrargrupo") {
                if (!esGrupo) return;
                try {
                    await sock.groupSettingUpdate(chat, "announcement");
                    await sock.sendMessage(chat, { text: "🔒⚡ *GRUPO CERRADO POR ADMINISTRACIÓN* ⚡🔒\n\n_En este momento solo administradores pueden enviar mensajes._" });
                } catch {
                    await sock.sendMessage(chat, { text: "❌ Error: Verifica que el bot sea administrador." }, { quoted: m });
                }
            }

            else if (comando === "abrir" || comando === "abrirgrupo") {
                if (!esGrupo) return;
                try {
                    await sock.groupSettingUpdate(chat, "not_announcement");
                    await sock.sendMessage(chat, { text: "🔓⚡ *GRUPO ABIERTO* ⚡🔓\n\n_Todos los miembros pueden escribir y participar nuevamente._" });
                } catch {
                    await sock.sendMessage(chat, { text: "❌ Error: Verifica que el bot sea administrador." }, { quoted: m });
                }
            }

            else if (comando === "ping") {
                await sock.sendMessage(chat, { text: "⚡🚀 *PONG!* Sistema MasterStreaming respondiendo al 100%." }, { quoted: m });
            }

            else if (comando === "tagall" || comando === "todos") {
                if (!esGrupo) return;
                const metadata = await sock.groupMetadata(chat);
                const participantes = metadata.participants.map(p => p.id);
                let mensajeTag = `⚡📢 *LLAMADO GENERAL MASTER STREAMING* 📢⚡\n\n${argumento ? `📝 *Nota:* ${argumento}\n\n` : ""}`;
                for (let p of participantes) {
                    mensajeTag += `@${p.split("@")[0]} `;
                }
                await sock.sendMessage(chat, { text: mensajeTag, mentions: participantes });
            }

            // ==========================================
            // 💼 ECONOMÍA Y JUEGOS
            // ==========================================
            else if (comando === "work" || comando === "chambear") {
                if (!economia[remitente]) economia[remitente] = 0;
                const recompensa = Math.floor(Math.random() * 300) + 100;
                economia[remitente] += recompensa;
                guardarDatos(USERS_PATH, economia);
                await sock.sendMessage(chat, { text: `💼⚡ *JORNADA COMPLETADA* ⚡💼\n\nGanaste: *$${recompensa} créditos Master*.\nSaldo total: *$${economia[remitente]} créditos*.` }, { quoted: m });
            }

            else if (comando === "money" || comando === "cartera") {
                const saldo = economia[remitente] || 0;
                await sock.sendMessage(chat, { text: `💰⚡ *BILLETERA VIRTUAL* ⚡💰\n\nTu saldo acumulado es de: *$${saldo} créditos Master*.` }, { quoted: m });
            }

            else if (comando === "doxeo") {
                const ipFalsa = `${Math.floor(Math.random()*190)+40}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;
                const doxeoText = `🛰️⚡ *RASTREO SATELITAL INICIADO...* ⚡🛰️\n\n` +
                                  `🌐 *IP:* ${ipFalsa}\n` +
                                  `📡 *Servidor:* Master-CDN Node\n` +
                                  `📍 *Región:* Sector de Enlace Seguro\n` +
                                  `🛡️ *Estatus:* Dispositivo Localizado con Éxito.`;
                await sock.sendMessage(chat, { text: doxeoText }, { quoted: m });
            }

        } catch (error) {
            console.error("Error en procesamiento:", error);
        }
    });
}

iniciarBot();
