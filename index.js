const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, jidNormalizedUser, downloadContentFromMessage } = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require("express");
const QRCode = require("qrcode");
const https = require("https");

// ==========================================
// 1. CONFIGURACIÓN Y SERVIDOR WEB
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwsfiLlP7ot1DSHiyLfBdXEMI_6sbt9fD0MXxynwGqPG-HDZPpTLiWffxzrFFLP5Nrl/exec";

// ☁️ CAJA FUERTE EN LA NUBE (FIREBASE)
const FIREBASE_URL = "https://masterbot-cd954-default-rtdb.firebaseio.com/database.json";

let db = { 
    comandos: {}, 
    gruposOTP: {}, 
    mapaGrupos: {}, 
    licencias: {}, 
    pinUsers: {}, 
    bienvenidas: {}, 
    creador: "", 
    pausado: false 
};

// ⚡ CACHÉ EN RAM PARA GRUPOS DE 600+ MIEMBROS (RESPUESTA EN 0.1 SEGUNDOS)
const groupCache = new Map();
async function obtenerMetadataRapida(sock, jid) {
    const ahora = Date.now();
    if (groupCache.has(jid)) {
        const cached = groupCache.get(jid);
        if (ahora - cached.time < 300000) return cached.data; // Dura 5 mins en RAM ultra rápida
    }
    try {
        const meta = await sock.groupMetadata(jid);
        groupCache.set(jid, { data: meta, time: ahora });
        return meta;
    } catch (e) {
        return groupCache.get(jid)?.data || { subject: "Grupo VIP", participants: [] };
    }
}

// CONEXIÓN A FIREBASE BLINDADA
async function cargarDB() {
    return new Promise((resolve) => {
        https.get(FIREBASE_URL, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (data && typeof data === 'object') {
                        db.comandos = data.comandos || {};
                        db.gruposOTP = data.gruposOTP || {};
                        db.mapaGrupos = data.mapaGrupos || {};
                        db.licencias = data.licencias || {};
                        db.pinUsers = data.pinUsers || {}; 
                        db.bienvenidas = data.bienvenidas || {};
                        db.creador = data.creador || ""; 
                        for (let key in data) {
                            if (!['comandos', 'gruposOTP', 'mapaGrupos', 'licencias', 'pinUsers', 'bienvenidas', 'creador', 'pausado'].includes(key)) {
                                db[key] = data[key];
                            }
                        }
                    }
                    console.log("⚡ Base de datos sincronizada desde Firebase.");
                    resolve();
                } catch (e) { resolve(); }
            });
        }).on('error', () => resolve());
    });
}

// Guardado asíncrono no bloqueante (No retrasa las respuestas del bot)
function guardarDB() {
    return new Promise((resolve) => {
        try {
            const dataStr = JSON.stringify(db);
            const options = { 
                method: 'PUT', 
                headers: { 
                    'Content-Type': 'application/json', 
                    'Content-Length': Buffer.byteLength(dataStr) 
                } 
            };
            const req = https.request(FIREBASE_URL, options, (res) => {
                res.on('data', () => {}); 
                res.on('end', () => resolve(true));
            });
            req.on('error', (e) => { console.log("⚠️ Error FB:", e.message); resolve(false); });
            req.write(dataStr);
            req.end();
        } catch (e) { resolve(false); }
    });
}

let qrActual = null;
let botConectado = false;

app.get("/", async (req, res) => {
    if (botConectado) return res.send(`<h1 style="color: #00ffcc; background: #0a0a0a; text-align: center; padding: 50px; font-family: monospace;">⚡ MASTER SYSTEM TURBO V2 [ONLINE] ⚡</h1>`);
    if (qrActual) {
        try {
            const qrImage = await QRCode.toDataURL(qrActual);
            return res.send(`<div style="text-align: center; margin-top: 30px; font-family: sans-serif;"><h2>⚡ ESCANEAR ACCESO MASTER PRO ⚡</h2><img src="${qrImage}" style="width: 280px; border: 3px solid #000; border-radius: 10px;" /><script>setTimeout(() => location.reload(), 15000);</script></div>`);
        } catch (e) { return res.send("Generando nodo..."); }
    }
    res.send("Iniciando módulos de alta velocidad...");
});
app.listen(PORT, () => console.log(`Servidor Turbo activo en puerto ${PORT}`));

// ==========================================
// 2. DISEÑO VISUAL REMEZCLADO Y UTILIDADES
// ==========================================
const pre = "╔══════════════════════════╗\n║ ⚡ *MASTER SYSTEM PRO*\n╠══════════════════════════╣";
const sep = "╠══════════════════════════╣";
const pie = "╚══════════════════════════╝";

function obtenerTextoMensaje(m) {
    if (!m || !m.message) return "";
    let msg = m.message;
    if (msg.ephemeralMessage) msg = msg.ephemeralMessage.message;
    if (msg.viewOnceMessage) msg = msg.viewOnceMessage.message;
    if (msg.viewOnceMessageV2) msg = msg.viewOnceMessageV2.message;
    if (msg.documentWithCaptionMessage) msg = msg.documentWithCaptionMessage.message;
    return (msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.videoMessage?.caption || "").trim();
}

async function descargarImagenBase64(msgImagen) {
    try {
        const stream = await downloadContentFromMessage(msgImagen, 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        return buffer.toString('base64');
    } catch (e) {
        return null;
    }
}

// FRASES DE BIENVENIDA Y DESPEDIDA CON ESTILO Y HUMOR
const FRASES_BIENVENIDA = [
    "🎉 ¡Qué milagro que te dejas ver, @user! Bienvenido(a) a *@grupo*. Siéntete como en tu casa, revisa el catálogo y pide sin miedo. 🚀",
    "🔥 ¡Alerta en el sistema! Acaba de entrar @user a *@grupo*, el nuevo cliente VIP. ¡Pásale a lo barrido y pregunta por tus cuentas favoritas! 🍿",
    "✨ ¡Bienvenido(a) a bordo, @user! Llegaste al mejor grupo (*@grupo*). Aquí no vendemos humo, puro entretenimiento del bueno. ¡Disfruta tu estancia! 👑",
    "🌮 ¡Pásale, @user! Te estábamos esperando en *@grupo*. Ponte cómodo(a), checa los precios y cualquier duda aquí andamos al tiro. ⚡"
];

const FRASES_DESPEDIDA = [
    "👋 @user abandonó el barco (*@grupo*). Ni modo, se perdió de las mejores promos. ¡Que la fuerza lo acompañe! 🛸",
    "🚪 ¡Fuga! @user salió corriendo de *@grupo* (seguro le dio miedo tanto nivel). ¡Cierren la puerta para que no se meta el frío! 😂",
    "💨 Un minuto de silencio... @user nos acaba de dejar en *@grupo*. Te extrañaremos (bueno, poquito). ¡Hasta la vista, baby! 🕶️",
    "📉 Baja confirmada: @user se retiró de *@grupo*. ¡Le deseamos éxito y que nunca se le caiga el WiFi! 📡"
];

// ==========================================
// 3. NÚCLEO Y PROCESADOR DE ALTA VELOCIDAD
// ==========================================
async function iniciarBot() {
    await cargarDB();
    const { state, saveCreds } = await useMultiFileAuthState("auth_session");
    const sock = makeWASocket({ 
        auth: state, 
        logger: pino({ level: "silent" }), 
        printQRInTerminal: true,
        syncFullHistory: false // Evita que el bot se congele descargando historial viejo
    });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (update) => {
        const { connection, qr } = update;
        if (qr) { qrActual = qr; botConectado = false; }
        if (connection === "close") setTimeout(iniciarBot, 4000);
        else if (connection === "open") { botConectado = true; qrActual = null; }
    });

    // ==========================================
    // DETECTOR DE ENTRADAS Y SALIDAS (BIENVENIDA / DESPEDIDA)
    // ==========================================
    sock.ev.on("group-participants.update", async (anu) => {
        try {
            const chat = anu.id;
            // Actualizar caché si entran o salen miembros
            groupCache.delete(chat);

            const configB = db.bienvenidas?.[chat];
            if (!configB) return;

            // Verificar si tiene licencia vigente antes de saludar
            if (db.licencias?.[chat] && Date.now() > db.licencias[chat]) return;

            const metadata = await obtenerMetadataRapida(sock, chat);

            for (let p of anu.participants) {
                const userJid = typeof p === 'string' ? p : (p.id || p.jid);
                if (!userJid) continue;
                const tag = `@${userJid.split("@")[0]}`;

                // BIENVENIDA CÁLIDA / CON HUMOR
                if (anu.action === "add" && configB.welcome) {
                    const fraseRandom = FRASES_BIENVENIDA[Math.floor(Math.random() * FRASES_BIENVENIDA.length)];
                    let textoBase = configB.welcomeMsg || fraseRandom;
                    textoBase = textoBase.replace(/@user/gi, tag).replace(/@grupo/gi, metadata.subject);

                    const msgFinal = `╔══════════════════════════╗\n║ 🌟 *NUEVO INGRESO VIP* 🌟\n╠══════════════════════════╣\n${textoBase}\n╚══════════════════════════╝`;

                    let ppUrl = "https://i.imgur.com/OFOwV0Y.jpeg";
                    try { ppUrl = await sock.profilePictureUrl(userJid, "image"); } catch (e) {
                        try { ppUrl = await sock.profilePictureUrl(chat, "image"); } catch (e2) {}
                    }

                    try {
                        await sock.sendMessage(chat, { image: { url: ppUrl }, caption: msgFinal, mentions: [userJid] });
                    } catch (err) {
                        await sock.sendMessage(chat, { text: msgFinal, mentions: [userJid] });
                    }
                }

                // DESPEDIDA / SALIDA
                if (anu.action === "remove" && configB.bye) {
                    const fraseRandom = FRASES_DESPEDIDA[Math.floor(Math.random() * FRASES_DESPEDIDA.length)];
                    let textoBase = configB.byeMsg || fraseRandom;
                    textoBase = textoBase.replace(/@user/gi, tag).replace(/@grupo/gi, metadata.subject);

                    const msgFinal = `╔══════════════════════════╗\n║ 🚪 *REGISTRO DE SALIDA* 🚪\n╠══════════════════════════╣\n${textoBase}\n╚══════════════════════════╝`;

                    await sock.sendMessage(chat, { text: msgFinal, mentions: [userJid] });
                }
            }
        } catch (err) {}
    });

    // ==========================================
    // PROCESADOR DE COMANDOS INSTANTÁNEO
    // ==========================================
    sock.ev.on("messages.upsert", async (chatUpdate) => {
        try {
            if (!chatUpdate.messages) return;
            const m = chatUpdate.messages[0];
            if (!m.message || m.key.fromMe) return;

            const texto = obtenerTextoMensaje(m);
            const chat = m.key.remoteJid;
            if (!texto || !texto.startsWith(".")) return;

            // Separador que respeta saltos de línea para catálogos largos
            const cuerpoSinPunto = texto.slice(1).trim();
            const primerEspacio = cuerpoSinPunto.search(/\s/);
            let comando = (primerEspacio === -1 ? cuerpoSinPunto : cuerpoSinPunto.slice(0, primerEspacio)).toLowerCase();
            let rawResto = primerEspacio === -1 ? "" : cuerpoSinPunto.slice(primerEspacio).trim();

            // SOPORTE INTELIGENTE PARA .setstock (PEGADO) O .set stock (SEPARADO)
            if (comando.startsWith("set") && comando.length > 3 && comando !== "setbienvenida" && comando !== "setdespedida") {
                const pegadoNombre = comando.slice(3);
                comando = "set";
                rawResto = pegadoNombre + (rawResto ? " " + rawResto : "");
            } else if (comando.startsWith("del") && comando.length > 3 && comando !== "delpin") {
                const pegadoDel = comando.slice(3);
                comando = "del";
                rawResto = pegadoDel + (rawResto ? " " + rawResto : "");
            }

            const args = rawResto ? rawResto.split(/\s+/) : [];
            const esGrupo = chat.endsWith("@g.us");
            const senderId = m.key.participant || chat;

            const responder = async (txt, extra = {}) => await sock.sendMessage(chat, { text: txt, ...extra }, { quoted: m });

            // ==========================================
            // 1. AUTO-REGISTRO DEL CREADOR
            // ==========================================
            if (comando === "soycreador") {
                if (db.creador !== "" && db.creador !== senderId) return responder(`${pre}\n║ ⚠️ El sistema ya tiene dueño.\n${pie}`);
                db.creador = senderId;
                guardarDB();
                return responder(`╔══════════════════════════╗\n║ 👑 *CREADOR VINCULADO*\n╠══════════════════════════╣\n║ ID: ${senderId.split("@")[0]}\n║ Control maestro activado.\n╚══════════════════════════╝`);
            }

            const isCreator = (db.creador === senderId);

            // ==========================================
            // 2. VERIFICADOR ESTRICTO DE LICENCIAS POR GRUPO
            // ==========================================
            if (esGrupo && !isCreator) {
                const vencimiento = db.licencias?.[chat];
                // Si el grupo tenía licencia y ya venció, o si quieres que solo opere con licencia activa:
                if (vencimiento && Date.now() > vencimiento) {
                    return responder(`╔══════════════════════════╗\n║ ⛔ *LICENCIA VENCIDA* ⛔\n╠══════════════════════════╣\n║ El tiempo de renta del bot\n║ en este grupo ha finalizado.\n║\n║ 📲 Contacta al Creador para\n║ renovar tu activación remota.\n╚══════════════════════════╝`);
                }
            }

            // ==========================================
            // 3. RESPUESTA ULTRA-RÁPIDA DE CATÁLOGOS (.stock, .netflix, etc.)
            // ==========================================
            // Se ejecuta ANTES de pedir metadata a WhatsApp para que responda en 0.05 segundos
            const comandosReservados = [
                "soycreador", "nube", "listagrupos", "licencia", "activarpin", "desactivarpin",
                "addpin", "delpin", "pin", "extraer", "cerrar", "abrir", "n", "kick", "sacar",
                "link", "tagall", "activar", "desactivar", "bienvenida", "despedida",
                "setbienvenida", "setdespedida", "set", "del", "listacmd", "comandos",
                "play", "musica", "carrera", "bomba", "casino", "slots", "dado", "ruleta",
                "suerte", "doxeo", "doxxear", "calentura", "pajero", "lesbiometro",
                "ship", "parejas", "piropo", "menu", "help", "juegos", "entretenimiento"
            ];

            if (!comandosReservados.includes(comando)) {
                let itemGuardado = null;
                if (esGrupo && db[chat]?.comandos && db[chat].comandos[comando]) {
                    itemGuardado = db[chat].comandos[comando];
                } else if (db.comandos && db.comandos[comando]) {
                    itemGuardado = db.comandos[comando];
                } else if (esGrupo && db["120363409863908124@g.us"]?.comandos?.[comando] && isCreator) {
                    itemGuardado = db["120363409863908124@g.us"].comandos[comando];
                }

                if (itemGuardado) {
                    // Si se guardó con IMAGEN + TEXTO (o solo imagen)
                    if (typeof itemGuardado === "object" && itemGuardado.image) {
                        const imgBuffer = Buffer.from(itemGuardado.image, 'base64');
                        const cap = itemGuardado.text || "";
                        return await sock.sendMessage(chat, { image: imgBuffer, caption: cap }, { quoted: m });
                    }
                    // Si es solo TEXTO
                    const txtResp = typeof itemGuardado === "object" ? itemGuardado.text : itemGuardado;
                    if (txtResp.includes("╔═════") || txtResp.includes("━━━")) {
                        return responder(txtResp);
                    }
                    return responder(`╔══════════════════════════╗\n║ 💡 *INFORMACIÓN*\n╠══════════════════════════╣\n${txtResp}\n╚══════════════════════════╝`);
                }
            }

            // ==========================================
            // 4. OBTENER PERMISOS DE ADMIN (CON CACHÉ TURBO)
            // ==========================================
            let esAdmin = isCreator;
            let groupMetadata = null;
            if (esGrupo) {
                groupMetadata = await obtenerMetadataRapida(sock, chat);
                if (!esAdmin && groupMetadata?.participants) {
                    const senderObj = groupMetadata.participants.find(p => p.id === senderId);
                    esAdmin = senderObj?.admin === 'admin' || senderObj?.admin === 'superadmin';
                }
            }

            // ==========================================
            // 5. PANEL DEL CREADOR (RENTAS Y LICENCIAS)
            // ==========================================
            if (comando === "nube" && isCreator) {
                const exito = await guardarDB();
                if (exito) return responder(`╔══════════════════════════╗\n║ ☁️ *FIREBASE CLOUD PRO*\n╠══════════════════════════╣\n║ ✅ Sincronización perfecta.\n║ Textos, fotos (.set) y rentas\n║ están seguros en la nube.\n╚══════════════════════════╝`);
                else return responder(`${pre}\n║ ⚠️ Error al conectar con Firebase.\n${pie}`);
            }

            if (comando === "listagrupos" && isCreator) {
                const grupos = await sock.groupFetchAllParticipating();
                let txt = `╔══════════════════════════╗\n║ 👑 *PANEL MAESTRO RENTAS*\n╠══════════════════════════╣\n`;
                let i = 1; db.mapaGrupos = {}; 
                for (const jid in grupos) {
                    const pinActivo = db.gruposOTP[jid] ? "✅" : "❌";
                    const wActivo = db.bienvenidas?.[jid]?.welcome ? "🟢" : "⚪";
                    let vencimiento = "⚠️ Sin licencia";
                    if (db.licencias[jid]) {
                        const restanteMs = db.licencias[jid] - Date.now();
                        if (restanteMs <= 0) {
                            vencimiento = "🔴 VENCIDA";
                        } else {
                            const diasRest = Math.ceil(restanteMs / (1000 * 60 * 60 * 24));
                            const fVence = new Date(db.licencias[jid]).toLocaleDateString('es-MX');
                            vencimiento = `🟢 ${diasRest}d (${fVence})`;
                        }
                    }
                    txt += `║ *${i}.* ${grupos[jid].subject}\n║  ├ 🔑 OTP: ${pinActivo} | 👋 Bienv: ${wActivo}\n║  └ 📅 Licencia: ${vencimiento}\n║\n`;
                    db.mapaGrupos[i] = jid; i++;
                }
                txt += `╚══════════════════════════╝\n⚡ *Comandos Creador:*\n• _.licencia [días] [num]_\n• _.licencia off [num]_ (Bloquear ya)\n• _.activarpin [num]_`;
                guardarDB();
                return responder(txt);
            }

            if (comando === "licencia" && isCreator) {
                const arg1 = args[0]?.toLowerCase();
                const num = args[1];
                if (!arg1 || !num) return responder(`${pre}\n║ ⚠️ Uso:\n║ • .licencia [días] [num_grupo]\n║ • .licencia off [num_grupo]\n${pie}`);
                const jid = db.mapaGrupos?.[num]; 
                if (!jid) return responder(`${pre}\n║ ⚠️ Número de grupo inválido.\n║ Usa .listagrupos primero.\n${pie}`);

                if (arg1 === "off" || arg1 === "0" || arg1 === "cortar") {
                    db.licencias[jid] = Date.now() - 10000; // Vencida inmediatamente
                    guardarDB();
                    try { await sock.sendMessage(jid, { text: `╔══════════════════════════╗\n║ ⛔ *SISTEMA SUSPENDIDO*\n╠══════════════════════════╣\n║ La licencia de este grupo ha\n║ finalizado. Contacta al Creador\n║ para renovar el servicio.\n╚══════════════════════════╝` }); } catch(e) {}
                    return responder(`${pre}\n║ 🔴 *LICENCIA CORTADA*\n║ El grupo ${num} ha quedado bloqueado.\n${pie}`);
                }

                const dias = parseInt(arg1);
                if (isNaN(dias) || dias <= 0) return responder(`${pre}\n║ ⚠️ Ingresa un número de días válido.\n${pie}`);
                
                db.licencias[jid] = Date.now() + (dias * 24 * 60 * 60 * 1000);
                if (!db[jid]) db[jid] = { comandos: {} }; 
                guardarDB();
                
                const fFin = new Date(db.licencias[jid]).toLocaleDateString('es-MX');
                try { 
                    await sock.sendMessage(jid, { text: `╔══════════════════════════╗\n║ ⚡ *LICENCIA ACTIVADA* ⚡\n╠══════════════════════════╣\n║ ✅ El Creador ha habilitado\n║ el bot en este grupo.\n║ 📅 Duración: *${dias} días*\n║ 🛑 Vence el: *${fFin}*\n║\n║ Escribe *.menu* para comenzar.\n╚══════════════════════════╝` }); 
                } catch(e) {}
                return responder(`${pre}\n║ ✅ *LICENCIA OTORGADA*\n║ Grupo ${num} activo por ${dias} días.\n║ Vence: ${fFin}\n${pie}`);
            }

            if (comando === "activarpin" && isCreator) {
                const num = args[0]; const jid = db.mapaGrupos?.[num]; if (!jid) return;
                db.gruposOTP[jid] = true; guardarDB();
                return responder(`${pre}\n║ ✅ *OTP DESBLOQUEADO*\n║ Grupo ${num} tiene acceso a PIN.\n${pie}`);
            }

            if (comando === "desactivarpin" && isCreator) {
                const num = args[0]; const jid = db.mapaGrupos?.[num]; if (!jid) return;
                db.gruposOTP[jid] = false; guardarDB();
                return responder(`${pre}\n║ ⛔ *OTP BLOQUEADO*\n║ Permiso revocado al grupo ${num}.\n${pie}`);
            }

            // ==========================================
            // 6. ACTIVAR BIENVENIDA, DESPEDIDA Y BASE DE DATOS
            // ==========================================
            if (comando === "activar" || comando === "desactivar") {
                if (!esGrupo || !esAdmin) return;
                const sub = args[0]?.toLowerCase() || "";
                const encender = comando === "activar";

                if (!db.bienvenidas) db.bienvenidas = {};
                if (!db.bienvenidas[chat]) db.bienvenidas[chat] = { welcome: false, bye: false };
                if (!db[chat]) db[chat] = { comandos: {} };

                // .activar bienvenida / .desactivar bienvenida
                if (sub === "bienvenida" || sub === "welcome") {
                    db.bienvenidas[chat].welcome = encender;
                    guardarDB();
                    return responder(`╔══════════════════════════╗\n║ 👋 *SISTEMA DE BIENVENIDA*\n╠══════════════════════════╣\n║ Estado: ${encender ? "🟢 *ACTIVADO*" : "🔴 *DESACTIVADO*"}\n║\n║ ${encender ? "El bot recibirá a los nuevos\n║ miembros con mensajes chidos." : "Ya no se enviarán bienvenidas."}\n╚══════════════════════════╝`);
                }

                // .activar despedida / .activar salida / .desactivar despedida
                if (sub === "despedida" || sub === "salida" || sub === "bye") {
                    db.bienvenidas[chat].bye = encender;
                    guardarDB();
                    return responder(`╔══════════════════════════╗\n║ 🚪 *SISTEMA DE DESPEDIDA*\n╠══════════════════════════╣\n║ Estado: ${encender ? "🟢 *ACTIVADO*" : "🔴 *DESACTIVADO*"}\n║\n║ ${encender ? "El bot avisará con humor cuando\n║ alguien se salga del grupo." : "Ya no se anunciarán salidas."}\n╚══════════════════════════╝`);
                }

                // Si solo escribe .activar, inicia la DB del grupo
                guardarDB();
                return responder(`╔══════════════════════════╗\n║ ⚡ *GRUPO INICIALIZADO*\n╠══════════════════════════╣\n║ ✅ Cajón de comandos activo.\n║\n║ 💡 *Opciones extra:*\n║ • _.activar bienvenida_\n║ • _.activar despedida_\n║ • _.set [comando] [texto]_\n╚══════════════════════════╝`);
            }

            // Atajos directos: .bienvenida on/off y .despedida on/off
            if (comando === "bienvenida" || comando === "despedida") {
                if (!esGrupo || !esAdmin) return;
                if (!db.bienvenidas) db.bienvenidas = {};
                if (!db.bienvenidas[chat]) db.bienvenidas[chat] = { welcome: false, bye: false };
                const modoOff = args[0]?.toLowerCase() === "off" || args[0]?.toLowerCase() === "apagar";

                if (comando === "bienvenida") {
                    db.bienvenidas[chat].welcome = !modoOff;
                    guardarDB();
                    return responder(`${pre}\n║ 👋 Bienvenida: ${!modoOff ? "🟢 *ACTIVA*" : "🔴 *APAGADA*"}\n${pie}`);
                } else {
                    db.bienvenidas[chat].bye = !modoOff;
                    guardarDB();
                    return responder(`${pre}\n║ 🚪 Despedida: ${!modoOff ? "🟢 *ACTIVA*" : "🔴 *APAGADA*"}\n${pie}`);
                }
            }

            if (comando === "setbienvenida" && esGrupo && esAdmin) {
                if (!rawResto) return responder(`${pre}\n║ ⚠️ Escribe el mensaje.\n║ Usa @user y @grupo si gustas.\n${pie}`);
                if (!db.bienvenidas) db.bienvenidas = {};
                if (!db.bienvenidas[chat]) db.bienvenidas[chat] = { welcome: true, bye: false };
                db.bienvenidas[chat].welcome = true;
                db.bienvenidas[chat].welcomeMsg = rawResto;
                guardarDB();
                return responder(`${pre}\n║ ✅ Bienvenida personalizada lista.\n${pie}`);
            }

            if (comando === "setdespedida" && esGrupo && esAdmin) {
                if (!rawResto) return responder(`${pre}\n║ ⚠️ Escribe el mensaje de salida.\n${pie}`);
                if (!db.bienvenidas) db.bienvenidas = {};
                if (!db.bienvenidas[chat]) db.bienvenidas[chat] = { welcome: false, bye: true };
                db.bienvenidas[chat].bye = true;
                db.bienvenidas[chat].byeMsg = rawResto;
                guardarDB();
                return responder(`${pre}\n║ ✅ Despedida personalizada lista.\n${pie}`);
            }

            // ==========================================
            // 7. SISTEMA .SET AVANZADO (GUARDA IMAGEN + TEXTO O SOLO TEXTO)
            // ==========================================
            if (comando === "set" && esAdmin) {
                const espacioNombre = rawResto.search(/\s/);
                const nCmd = (espacioNombre === -1 ? rawResto : rawResto.slice(0, espacioNombre)).toLowerCase().replace(/^\./, "");
                let contenidoTexto = espacioNombre === -1 ? "" : rawResto.slice(espacioNombre).trim();

                if (!nCmd) {
                    return responder(`╔══════════════════════════╗\n║ ⚠️ *MODO DE USO (.SET)*\n╠══════════════════════════╣\n║ 📝 *Solo texto:*\n║ .set stock [tu lista]\n║ .setstock [tu lista]\n║\n║ 📸 *Con Imagen:*\n║ Envía o responde a una foto\n║ poniendo *.set netflix* y el\n║ texto que quieras.\n╚══════════════════════════╝`);
                }

                // Detectar si el mensaje lleva imagen directa o si está respondiendo a una imagen
                const quotedMsg = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                const imgMsg = m.message.imageMessage || quotedMsg?.imageMessage;

                // Si no puso texto después del nombre pero respondió a un mensaje con texto/caption, lo toma de ahí
                if (!contenidoTexto && quotedMsg) {
                    contenidoTexto = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || quotedMsg.imageMessage?.caption || "";
                }

                let imgBase64 = null;
                if (imgMsg) {
                    imgBase64 = await descargarImagenBase64(imgMsg);
                }

                if (!contenidoTexto && !imgBase64) {
                    return responder(`${pre}\n║ ⚠️ Debes escribir un texto o\n║ responder a una imagen/mensaje.\n${pie}`);
                }

                const objetoGuardar = imgBase64 
                    ? { text: contenidoTexto, image: imgBase64 } 
                    : contenidoTexto;

                if (esGrupo) {
                    if (!db[chat]) db[chat] = { comandos: {} };
                    if (!db[chat].comandos) db[chat].comandos = {};
                    db[chat].comandos[nCmd] = objetoGuardar;
                } else {
                    db.comandos[nCmd] = objetoGuardar;
                }

                guardarDB();
                return responder(`╔══════════════════════════╗\n║ ✅ *COMANDO GUARDADO*\n╠══════════════════════════╣\n║ 🏷️ Atajo: *.${nCmd}*\n║ 📦 Tipo: ${imgBase64 ? "📸 Imagen + Texto" : "📝 Texto rápido"}\n║ ☁️ Respaldado en Firebase.\n╚══════════════════════════╝`);
            }

            if (comando === "del" && esAdmin) {
                const nCmd = args[0]?.toLowerCase().replace(/^\./, "");
                if (!nCmd) return responder(`${pre}\n║ ⚠️ Uso: .del [nombre]\n${pie}`);
                if (esGrupo && db[chat]?.comandos && db[chat].comandos[nCmd]) {
                    delete db[chat].comandos[nCmd];
                } else if (!esGrupo && db.comandos[nCmd]) {
                    delete db.comandos[nCmd];
                } else {
                    return responder(`${pre}\n║ ⚠️ El comando .${nCmd} no existe.\n${pie}`);
                }
                guardarDB();
                return responder(`${pre}\n║ 🗑️ Comando *.${nCmd}* eliminado.\n${pie}`);
            }

            if (comando === "listacmd" || comando === "comandos") {
                const cmdsGrupo = esGrupo && db[chat]?.comandos ? Object.keys(db[chat].comandos) : [];
                const cmdsGlobal = db.comandos ? Object.keys(db.comandos) : [];
                const todos = [...new Set([...cmdsGrupo, ...cmdsGlobal])];
                if (todos.length === 0) return responder(`${pre}\n║ 📭 No hay comandos guardados aún.\n║ Crea uno con: *.set stock [texto]*\n${pie}`);
                
                let listaTxt = `╔══════════════════════════╗\n║ 📂 *COMANDOS GUARDADOS*\n╠══════════════════════════╣\n`;
                todos.forEach(c => {
                    const item = (esGrupo && db[chat]?.comandos?.[c]) || db.comandos[c];
                    const icono = (typeof item === "object" && item.image) ? "📸" : "📝";
                    listaTxt += `║ ${icono} *.${c}*\n`;
                });
                listaTxt += `╚══════════════════════════╝`;
                return responder(listaTxt);
            }

            // ==========================================
            // 8. MÚSICA Y AUDIO (.PLAY) - RÁPIDO Y SIN CAÍDAS
            // ==========================================
            if (comando === "play" || comando === "musica") {
                if (!rawResto) return responder(`${pre}\n║ 🎵 *BUSCADOR MUSICAL*\n║ Uso: *.play [nombre de canción]*\n║ Ej: _.play Belleza de Cantina_\n${pie}`);
                
                await responder(`${pre}\n║ 🎧 *Buscando:* _${rawResto}_...\n${pie}`);
                try {
                    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(rawResto)}&media=music&limit=1`);
                    const data = await res.json();
                    if (!data.results || data.results.length === 0) {
                        return responder(`${pre}\n║ ❌ No encontré esa canción.\n║ Intenta con otro nombre o artista.\n${pie}`);
                    }

                    const track = data.results[0];
                    const portadaAltaRes = track.artworkUrl100 ? track.artworkUrl100.replace("100x100bb", "600x600bb") : "https://i.imgur.com/OFOwV0Y.jpeg";
                    const duracionMin = track.trackTimeMillis ? `${Math.floor(track.trackTimeMillis / 60000)}:${String(Math.floor((track.trackTimeMillis % 60000) / 1000)).padStart(2, '0')}` : "N/A";
                    const fechaLanz = track.releaseDate ? track.releaseDate.slice(0, 4) : " Clásico";

                    const infoCancion = `╔══════════════════════════╗
║ 🎶 *MASTER MUSIC PLAYER* 🎶
╠══════════════════════════╣
║ 🎵 *Título:* ${track.trackName}
║ 🎤 *Artista:* ${track.artistName}
║ 💿 *Álbum:* ${track.collectionName || "Sencillo"}
║ ⏱️ *Duración:* ${duracionMin} mins
║ 📅 *Año:* ${fechaLanz}
║ 🎼 *Género:* ${track.primaryGenreName || "Música"}
╚══════════════════════════╝
_⬇️ Enviando pista de audio..._`;

                    await sock.sendMessage(chat, { image: { url: portadaAltaRes }, caption: infoCancion }, { quoted: m });

                    if (track.previewUrl) {
                        const audioRes = await fetch(track.previewUrl);
                        const arrayBuffer = await audioRes.arrayBuffer();
                        const audioBuffer = Buffer.from(arrayBuffer);
                        await sock.sendMessage(chat, { 
                            audio: audioBuffer, 
                            mimetype: 'audio/mp4', 
                            ptt: false, // false = se envía como canción reproducible; cambia a true si lo prefieres como nota de voz
                            fileName: `${track.trackName}.m4a`
                        }, { quoted: m });
                    }
                } catch (e) {
                    return responder(`${pre}\n║ ⚠️ Error al descargar la pista.\n${pie}`);
                }
                return;
            }

            // ==========================================
            // 9. GESTIÓN DE OPERADORES PIN Y EXTRACCIÓN OTP
            // ==========================================
            if (comando === "addpin" && isCreator) {
                if (!esGrupo) return responder(`${pre}\n║ ⚠️ Usa esto dentro del grupo.\n${pie}`);
                let target = m.message.extendedTextMessage?.contextInfo?.participant || m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (!target) return responder(`${pre}\n║ ⚠️ Etiqueta al usuario.\n║ Ej: .addpin @Cliente\n${pie}`);
                
                if (!db.pinUsers) db.pinUsers = {};
                if (!db.pinUsers[chat]) db.pinUsers[chat] = [];
                if (!db.pinUsers[chat].includes(target)) db.pinUsers[chat].push(target);
                
                guardarDB();
                return responder(`╔══════════════════════════╗\n║ 🔑 *OPERADOR AUTORIZADO*\n╠══════════════════════════╣\n║ @${target.split("@")[0]} ahora puede\n║ usar el extractor .pin\n╚══════════════════════════╝`, { mentions: [target] });
            }

            if (comando === "delpin" && isCreator) {
                if (!esGrupo) return;
                let target = m.message.extendedTextMessage?.contextInfo?.participant || m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (!target) return;
                
                if (db.pinUsers && db.pinUsers[chat]) {
                    db.pinUsers[chat] = db.pinUsers[chat].filter(id => id !== target);
                    guardarDB();
                }
                return responder(`╔══════════════════════════╗\n║ 🗑️ *PERMISO REVOCADO*\n╠══════════════════════════╣\n║ @${target.split("@")[0]} ya no tiene\n║ acceso al comando .pin\n╚══════════════════════════╝`, { mentions: [target] });
            }

            if (comando === "pin" || comando === "extraer") {
                if (!esGrupo) return responder(`${pre}\n║ ⛔ Solo funciona en grupos.\n${pie}`);
                
                const autorizado = isCreator || (db.pinUsers && db.pinUsers[chat] && db.pinUsers[chat].includes(senderId));
                if (!autorizado) {
                    return responder(`╔══════════════════════════╗\n║ ⛔ *ACCESO DENEGADO*\n╠══════════════════════════╣\n║ Solo el Creador y Operadores\n║ autorizados pueden sacar PIN.\n╚══════════════════════════╝`);
                }

                if (!db.gruposOTP[chat] && !isCreator) return responder(`${pre}\n║ ⛔ *SERVICIO RESTRINGIDO*\n║ Este grupo no tiene plan OTP.\n${pie}`);

                const plat = args[0]?.trim().toLowerCase();
                const corr = args[1]?.trim().toLowerCase();
                const sub = args[2] ? args[2].trim().toLowerCase() : "4dig";
                if (!plat || !corr?.includes("@")) return responder(`${pre}\n║ ⚠️ Uso: .pin [plat] [correo]\n${pie}`);

                await responder(`${pre}\n║ ⏳ *Buscando código en vivo...*\n${pie}`);
                try {
                    const res = await fetch(`${APPS_SCRIPT_URL}?accion=extraer&plataforma=${encodeURIComponent(plat)}&correo=${encodeURIComponent(corr)}&subtipo=${encodeURIComponent(sub)}`);
                    const data = await res.json();
                    if (data?.ok) {
                        let ok = `╔══════════════════════════╗\n║ ✅ *CÓDIGO OTP RECIBIDO*\n╠══════════════════════════╣\n║ 📺 Servicio: ${data.type || plat.toUpperCase()}\n║ 🔑 Código: *${data.code}*\n`;
                        if (data.link) ok += `║ 🔗 Link: ${data.link}\n`;
                        ok += `╚══════════════════════════╝`;
                        await sock.sendMessage(chat, { text: ok }, { quoted: m });
                    } else responder(`${pre}\n║ ❌ *SIN RESULTADOS*\n║ ${data.error || "No llegó código reciente."}\n${pie}`);
                } catch (e) { responder(`${pre}\n║ ⚠️ Error de conexión OTP.\n${pie}`); }
                return;
            }

            // ==========================================
            // 10. MODERACIÓN INTELIGENTE Y ANUNCIOS (.N)
            // ==========================================
            if (comando === "cerrar" || comando === "abrir") {
                if (!esGrupo || !esAdmin) return;
                const esCerrar = comando === "cerrar";
                const accionConfig = esCerrar ? "announcement" : "not_announcement";
                const timeArg = args[0]; let delayMs = 0; let timeStr = "";

                if (timeArg) {
                    const match = timeArg.match(/^(\d+)([smh])$/i);
                    if (match) {
                        const value = parseInt(match[1]); const unit = match[2].toLowerCase();
                        if (unit === 's') { delayMs = value * 1000; timeStr = `${value} segs`; }
                        else if (unit === 'm') { delayMs = value * 60000; timeStr = `${value} mins`; }
                        else if (unit === 'h') { delayMs = value * 3600000; timeStr = `${value} hrs`; }
                    } else return responder(`${pre}\n║ ⚠️ Uso: .${comando} 5m, 1h, 30s\n${pie}`);
                }

                if (delayMs > 0) {
                    const cDate = new Date(Date.now() + delayMs);
                    const tFormat = cDate.toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute:'2-digit' });
                    const msg = `╔══════════════════════════╗\n║ ⏳ *TEMPORIZADOR ACTIVO*\n╠══════════════════════════╣\n║ 👤 Admin: @${senderId.split("@")[0]}\n║ 📍 Grupo: ${groupMetadata.subject}\n║ ⏳ Se ${esCerrar ? "cerrará" : "abrirá"} en: *${timeStr}*\n║ 🕒 Hora exacta: ${tFormat} (MX)\n╚══════════════════════════╝`;
                    await sock.sendMessage(chat, { text: msg, mentions: [senderId] }, { quoted: m });
                    setTimeout(async () => {
                        try {
                            await sock.groupSettingUpdate(chat, accionConfig);
                            await sock.sendMessage(chat, { text: `╔══════════════════════════╗\n║ 🛡️ *SEGURIDAD DEL GRUPO*\n╠══════════════════════════╣\n║ 🔐 ESTADO: ${esCerrar ? "CERRADO 🔴" : "ABIERTO 🟢"}\n╚══════════════════════════╝\n_Temporizador completado._` });
                        } catch (e) {}
                    }, delayMs);
                    return;
                }

                try {
                    await sock.groupSettingUpdate(chat, accionConfig);
                    await sock.sendMessage(chat, { text: `╔══════════════════════════╗\n║ 🛡️ *SEGURIDAD DEL GRUPO*\n╠══════════════════════════╣\n║ 🔐 ESTADO: ${esCerrar ? "CERRADO 🔴" : "ABIERTO 🟢"}\n╚══════════════════════════╝` });
                } catch (error) { return responder(`${pre}\n║ ❌ Necesito ser Admin del grupo.\n${pie}`); }
                return;
            }

            if (comando === "n") {
                if (!esGrupo || !esAdmin) return;
                let txtMsg = rawResto;
                let isQuoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!txtMsg && isQuoted) { txtMsg = isQuoted.conversation || isQuoted.extendedTextMessage?.text || isQuoted.imageMessage?.caption || isQuoted.videoMessage?.caption || ""; }
                if (!txtMsg && !isQuoted && !m.message.imageMessage && !m.message.videoMessage) return responder(`${pre}\n║ ⚠️ Escribe o responde a un mensaje.\n${pie}`);
                
                const fch = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
                const finalTxt = `${txtMsg}\n\n| 🛡 *${groupMetadata.subject}* • ${fch}`;
                const menciones = groupMetadata.participants.map(p => p.id);

                try {
                    let buffer = null; let msgType = null;
                    if (m.message.imageMessage || m.message.videoMessage) {
                        msgType = m.message.imageMessage ? 'image' : 'video';
                        const stream = await downloadContentFromMessage(m.message[msgType + 'Message'], msgType);
                        buffer = Buffer.from([]); for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    } else if (isQuoted && (isQuoted.imageMessage || isQuoted.videoMessage)) {
                        msgType = isQuoted.imageMessage ? 'image' : 'video';
                        const stream = await downloadContentFromMessage(isQuoted[msgType + 'Message'], msgType);
                        buffer = Buffer.from([]); for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    }

                    if (buffer) {
                        if (msgType === 'image') await sock.sendMessage(chat, { image: buffer, caption: finalTxt, mentions: menciones });
                        else await sock.sendMessage(chat, { video: buffer, caption: finalTxt, mentions: menciones });
                    } else await sock.sendMessage(chat, { text: finalTxt, mentions: menciones });
                } catch (e) { await sock.sendMessage(chat, { text: finalTxt, mentions: menciones }); }
                return;
            }

            if (comando === "kick" || comando === "sacar") {
                if (!esGrupo || !esAdmin) return;
                let target = m.message.extendedTextMessage?.contextInfo?.participant || m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (!target) return responder(`${pre}\n║ ⚠️ Etiqueta o responde al usuario.\n${pie}`);
                if (target === db.creador) return responder(`${pre}\n║ 🛡️ Prohibido expulsar al Creador.\n${pie}`);
                try {
                    await sock.groupParticipantsUpdate(chat, [target], "remove");
                    groupCache.delete(chat);
                    return responder(`${pre}\n║ 👢 Usuario expulsado del grupo.\n${pie}`);
                } catch (e) { return responder(`${pre}\n║ ❌ No pude expulsarlo (verifica mi admin).\n${pie}`); }
            }

            if (comando === "link") {
                if (!esGrupo || !esAdmin) return;
                try {
                    const code = await sock.groupInviteCode(chat);
                    return responder(`${pre}\n║ 🔗 *LINK DE INVITACIÓN*\n║ https://chat.whatsapp.com/${code}\n${pie}`);
                } catch (e) { return responder(`${pre}\n║ ❌ Necesito ser Admin para ver el link.\n${pie}`); }
            }

            if (comando === "tagall") {
                if (!esGrupo || !esAdmin) return;
                let msgTag = `╔══════════════════════════╗\n║ 📢 *ATENCIÓN MIEMBROS*\n╠══════════════════════════╣\n`;
                const menciones = groupMetadata.participants.map(p => { msgTag += `║ ⚡ @${p.id.split("@")[0]}\n`; return p.id; });
                msgTag += `╚══════════════════════════╝`;
                await sock.sendMessage(chat, { text: msgTag, mentions: menciones });
                return;
            }

            // ==========================================
            // 11. ZONA DE JUEGOS Y ENTRETENIMIENTO
            // ==========================================
            if (comando === "carrera") {
                const msg = await sock.sendMessage(chat, { text: `${pre}\n║ 🏁 Preparando motores...\n${pie}` }, { quoted: m });
                const frames = [
                    `${pre}\n║ 🏁 *ARRANCA LA CARRERA*\n╠══════════════════════════╣\n║ 🚗💨          🏎️💨\n${pie}`,
                    `${pre}\n║ 🏁 *MITAD DE PISTA*\n╠══════════════════════════╣\n║     🚗💨    🏎️💨\n${pie}`,
                    `${pre}\n║ 🏁 *RECTA FINAL*\n╠══════════════════════════╣\n║             🚗💨🏎️💨\n║ 🏆 ¡GANÓ EL AUTO ROJO!\n${pie}`
                ];
                for (let i = 0; i < frames.length; i++) {
                    await new Promise(r => setTimeout(r, 1000));
                    await sock.sendMessage(chat, { edit: msg.key, text: frames[i] });
                }
                return;
            }

            if (comando === "bomba") {
                const msg = await sock.sendMessage(chat, { text: `${pre}\n║ 💣 *BOMBA ACTIVADA: 3...*\n${pie}` }, { quoted: m });
                await new Promise(r => setTimeout(r, 1000));
                await sock.sendMessage(chat, { edit: msg.key, text: `${pre}\n║ 💣 *BOMBA ACTIVADA: 2...*\n${pie}` });
                await new Promise(r => setTimeout(r, 1000));
                await sock.sendMessage(chat, { edit: msg.key, text: `💥💥 *¡KABOOM!* 💥💥\n_El grupo acaba de explotar._` });
                return;
            }

            if (comando === "casino" || comando === "slots") {
                const emojis = ["🍒", "🔔", "💎", "7️⃣", "🍉"];
                const r1 = emojis[Math.floor(Math.random() * emojis.length)];
                const r2 = emojis[Math.floor(Math.random() * emojis.length)];
                const r3 = emojis[Math.floor(Math.random() * emojis.length)];
                const win = (r1 === r2 && r2 === r3) ? "🎉 ¡JACKPOT MILLONARIO! 💰" : (r1 === r2 || r2 === r3) ? "✨ ¡Casi! Par ganador." : "📉 Suerte para la próxima.";
                return responder(`╔══════════════════════════╗\n║ 🎰 *CASINO MASTER VIP* 🎰\n╠══════════════════════════╣\n║      [ ${r1} | ${r2} | ${r3} ]\n╠══════════════════════════╣\n║ ${win}\n╚══════════════════════════╝`);
            }

            if (comando === "dado") {
                const cara = Math.floor(Math.random() * 6) + 1;
                return responder(`${pre}\n║ 🎲 El dado giró y cayó en: *${cara}* ✅\n${pie}`);
            }

            if (comando === "ruleta") {
                if (!esGrupo) return;
                if (esAdmin) return responder(`${pre}\n║ 🛡️ Los Admins son inmortales.\n${pie}`);
                if (Math.floor(Math.random() * 6) + 1 === 1) {
                    await responder(`${pre}\n║ 🔫 *¡BANG!* 💥 Te tocó la bala...\n${pie}`);
                    try { await sock.groupParticipantsUpdate(chat, [senderId], "remove"); groupCache.delete(chat); } catch(e) {}
                } else {
                    return responder(`${pre}\n║ 🔫 *Click...* Tambor vacío, vives un día más. 😅\n${pie}`);
                }
                return;
            }

            if (comando === "suerte") {
                return responder(`${pre}\n║ 🍀 Hoy tienes un *${Math.floor(Math.random() * 101)}%* de suerte.\n${pie}`);
            }

            if (comando === "doxeo" || comando === "doxxear") {
                let target = m.message.extendedTextMessage?.contextInfo?.participant || m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                let tag = target ? `@${target.split("@")[0]}` : "este usuario";
                const isps = ["Telmex (Colgado del vecino)", "Totalplay (Con adeudo)", "Izzi (Lento pero seguro)", "Starlink Pirata"];
                const locs = ["Ecatepec, Edomex", "Tepito, CDMX", "Zapopan, Jalisco", "Cuernavaca, Morelos", "Monterrey, NL"];
                const devices = ["Alcatel Pixi estrellado", "iPhone 16 Pro (Clon)", "Xiaomi con batería inflada", "Samsung J7 inmortal"];
                const secrets = ["Pide fiado y se hace pato", "Canta las de Jenni Rivera bañándose", "Le debe al Coppel desde 2021", "Usa cuentas prestadas"];
                const ip = `${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;
                
                return await sock.sendMessage(chat, { 
                    text: `╔══════════════════════════╗\n║ ☠️ *REPORTE DE DOXEO* ☠️\n╠══════════════════════════╣\n║ 👤 Objetivo: ${tag}\n║ 🌐 IP: ${ip}\n║ 📍 Ubicación: ${locs[Math.floor(Math.random()*locs.length)]}\n║ 📡 Red: ${isps[Math.floor(Math.random()*isps.length)]}\n║ 📱 Equipo: ${devices[Math.floor(Math.random()*devices.length)]}\n║ 🕵️ *Archivo confidencial:*\n║ › ${secrets[Math.floor(Math.random()*secrets.length)]}\n╚══════════════════════════╝`, 
                    mentions: target ? [target] : [] 
                }, { quoted: m });
            }

            if (comando === "calentura" || comando === "pajero" || comando === "lesbiometro") {
                let target = m.message.extendedTextMessage?.contextInfo?.participant || m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                let tag = target ? `@${target.split("@")[0]}` : "este usuario";
                const nivel = Math.floor(Math.random() * 101);
                let diag = nivel > 80 ? "🔥 ¡Nivel crítico, échenle agua fría!" : nivel > 40 ? "😏 Nivel moderado, sabe cosas." : "🧊 Más frío que el corazón de tu ex.";
                return await sock.sendMessage(chat, { text: `╔══════════════════════════╗\n║ 🌡️ *ESCÁNER: ${comando.toUpperCase()}*\n╠══════════════════════════╣\n║ 👤 Sujeto: ${tag}\n║ 📊 Resultado: *${nivel}%*\n║ 🩺 Diagnóstico: ${diag}\n╚══════════════════════════╝`, mentions: target ? [target] : [] }, { quoted: m });
            }

            if (comando === "ship" || comando === "parejas") {
                if (!esGrupo) return;
                const miembros = groupMetadata.participants.map(p => p.id);
                if (miembros.length < 2) return;
                const u1 = miembros[Math.floor(Math.random() * miembros.length)];
                const u2 = miembros[Math.floor(Math.random() * miembros.length)];
                const porc = Math.floor(Math.random() * 101);
                return await sock.sendMessage(chat, { text: `╔══════════════════════════╗\n║ 💘 *FLECHAZO EN EL GRUPO*\n╠══════════════════════════╣\n║ ❤️ @${u1.split("@")[0]}\n║ ❤️ @${u2.split("@")[0]}\n║ 📊 Compatibilidad: *${porc}%*\n║\n║ _¡Que inviten a la boda!_ 🥂\n╚══════════════════════════╝`, mentions: [u1, u2] }, { quoted: m });
            }

            if (comando === "piropo") {
                const piropos = [
                    "Si la belleza fuera pecado, tú ya no tendrías perdón de Dios. 😘",
                    "No eres Google, pero tienes todo lo que ando buscando. 😉",
                    "Quien fuera cargador para darte energía todo el día. ⚡",
                    "Estás como para invitarte unos tacos y no cobrarte la cuenta. 🌮"
                ];
                return responder(`${pre}\n║ 😏 ${piropos[Math.floor(Math.random() * piropos.length)]}\n${pie}`);
            }

            // ==========================================
            // 12. NUEVO MENÚ REMEZCLADO Y PANEL VISUAL
            // ==========================================
            if (comando === "menu" || comando === "help") {
                const fch = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'short' });
                let estadoLic = "🟢 Activa";
                if (esGrupo && db.licencias?.[chat]) {
                    const rest = Math.ceil((db.licencias[chat] - Date.now()) / (1000 * 60 * 60 * 24));
                    estadoLic = rest > 0 ? `🟢 ${rest} días restantes` : "🔴 Vencida";
                }

                let menuTxt = `╔══════════════════════════╗
║ ⚡ *MASTER SYSTEM PRO V2* ⚡
║ 🕒 ${fch}
║ 🛡️ Licencia: ${estadoLic}
╠══════════════════════════╣
║ 📦 *CATÁLOGO Y MULTIMEDIA*
║  ├ *.set* [cmd] [texto o foto]
║  ├ *.del* [cmd] (Borrar comando)
║  ├ *.listacmd* (Ver guardados)
║  └ *.play* [canción] (Música MP4)
║
║ 🔐 *EXTRACTOR DE CÓDIGOS*
║  └ *.pin* [plataforma] [correo]
║
║ 👋 *BIENVENIDAS Y SALIDAS*
║  ├ *.activar bienvenida*
║  ├ *.activar despedida*
║  ├ *.desactivar bienvenida*
║  └ *.desactivar despedida*
║
║ ⚙️ *MODERACIÓN DE GRUPO*
║  ├ *.cerrar* [5m] / *.abrir* [1h]
║  ├ *.n* [texto/foto] (Aviso global)
║  ├ *.kick* [@user] / *.tagall*
║  └ *.link* (Enlace del grupo)
║
║ 🎮 *ZONA DE JUEGOS*
║  └ *.juegos* (Ver minijuegos)
╚══════════════════════════╝`;
                
                if (isCreator) {
                    menuTxt += `\n\n╔══════════════════════════╗
║ 👑 *PANEL SECRETO CREADOR*
╠══════════════════════════╣
║  ├ *.listagrupos* (Ver rentas)
║  ├ *.licencia* [días] [num]
║  ├ *.licencia off* [num]
║  ├ *.activarpin* / *.desactivarpin*
║  ├ *.addpin* / *.delpin* [@user]
║  └ *.nube* (Sincronizar Firebase)
╚══════════════════════════╝`;
                }
                
                let imgUrl = "https://i.imgur.com/OFOwV0Y.jpeg"; 
                try {
                    const botJid = jidNormalizedUser(sock.user.id);
                    const profilePic = await sock.profilePictureUrl(botJid, 'image');
                    if (profilePic) imgUrl = profilePic;
                } catch (e) {}

                try { await sock.sendMessage(chat, { image: { url: imgUrl }, caption: menuTxt }, { quoted: m }); } 
                catch(e) { await sock.sendMessage(chat, { text: menuTxt }, { quoted: m }); }
                return;
            }

            if (comando === "juegos" || comando === "entretenimiento") {
                return responder(`╔══════════════════════════╗
║ 🎮 *CATÁLOGO DE JUEGOS* 🎮
╠══════════════════════════╣
║  ├ 🏎️ *.carrera* / 💣 *.bomba*
║  ├ 🎰 *.casino*  / 🎲 *.dado*
║  ├ 🔫 *.ruleta*  / 🍀 *.suerte*
║  ├ ☠️ *.doxeo*   / 💘 *.parejas*
║  ├ 🌡️ *.calentura* / *.pajero*
║  └ 😏 *.piropo*  / 🎵 *.play*
╚══════════════════════════╝`);
            }

        } catch (error) { console.error("Error procesando mensaje:", error); }
    });
}

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

iniciarBot();
