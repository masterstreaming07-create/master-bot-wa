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
const FIREBASE_BASE = "https://masterbot-cd954-default-rtdb.firebaseio.com";
const FIREBASE_URL = `${FIREBASE_BASE}/database.json`;

let db = { 
    comandos: {}, 
    gruposOTP: {}, 
    mapaGrupos: {}, 
    licencias: {}, 
    pinUsers: {}, 
    bienvenidas: {}, 
    candadoEstricto: false,
    creador: "", 
    pausado: false 
};

let dbCargadaConExito = false;

// ⚡ CACHÉ EN RAM PARA GRUPOS DE 600+ MIEMBROS
const groupCache = new Map();
async function obtenerMetadataRapida(sock, jid) {
    const ahora = Date.now();
    if (groupCache.has(jid)) {
        const cached = groupCache.get(jid);
        if (ahora - cached.time < 300000) return cached.data;
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
async function cargarDB(intentos = 3) {
    for (let i = 1; i <= intentos; i++) {
        const exito = await new Promise((resolve) => {
            https.get(FIREBASE_URL, (res) => {
                if (res.statusCode !== 200) return resolve(false);
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
                            db.candadoEstricto = data.candadoEstricto || false;
                            db.creador = data.creador || ""; 
                            for (let key in data) {
                                if (!['comandos', 'gruposOTP', 'mapaGrupos', 'licencias', 'pinUsers', 'bienvenidas', 'candadoEstricto', 'creador', 'pausado'].includes(key)) {
                                    db[key] = data[key];
                                }
                            }
                        }
                        dbCargadaConExito = true;
                        console.log("⚡ Base de datos sincronizada desde Firebase.");
                        resolve(true);
                    } catch (e) { resolve(false); }
                });
            }).on('error', () => resolve(false));
        });
        if (exito) return true;
        await new Promise(r => setTimeout(r, 2000));
    }
    return false;
}

// GUARDADO QUIRÚRGICO (PATCH) PARA AHORRAR RAM Y PREVENIR RESETEOS
function guardarDB(nodoEspecifico = null, valorNodo = null) {
    return new Promise(async (resolve) => {
        if (!dbCargadaConExito) return resolve(false);
        try {
            const payload = nodoEspecifico ? { [nodoEspecifico]: valorNodo } : db;
            const dataStr = JSON.stringify(payload);
            const options = { 
                method: 'PATCH', 
                headers: { 
                    'Content-Type': 'application/json', 
                    'Content-Length': Buffer.byteLength(dataStr) 
                } 
            };
            const req = https.request(FIREBASE_URL, options, (res) => {
                res.on('data', () => {}); 
                res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300));
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
// 2. DISEÑO VISUAL ADAPTADO A CELULAR
// ==========================================
const pre = "┏━━━━━━━━━━━━━━━━━━━┓\n┃ ⚡ *MASTER SYSTEM PRO*\n┣━━━━━━━━━━━━━━━━━━━┫";
const sep = "┣━━━━━━━━━━━━━━━━━━━┫";
const pie = "┗━━━━━━━━━━━━━━━━━━━┛";

function obtenerTextoMensaje(m) {
    if (!m || !m.message) return "";
    let msg = m.message;
    if (msg.ephemeralMessage) msg = msg.ephemeralMessage.message;
    if (msg.viewOnceMessage) msg = msg.viewOnceMessage.message;
    if (msg.viewOnceMessageV2) msg = msg.viewOnceMessageV2.message;
    if (msg.viewOnceMessageV2Extension) msg = msg.viewOnceMessageV2Extension.message;
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

async function obtenerImagenGrupoOBot(sock, groupJid) {
    let urlImagen = null;
    try {
        urlImagen = await sock.profilePictureUrl(groupJid, "image");
    } catch (e) {
        try {
            const botJid = jidNormalizedUser(sock.user.id);
            urlImagen = await sock.profilePictureUrl(botJid, "image");
        } catch (e2) {
            urlImagen = null;
        }
    }

    if (!urlImagen) return null;

    try {
        const res = await fetch(urlImagen);
        if (!res.ok) return null;
        const arrayBuffer = await res.arrayBuffer();
        return Buffer.from(arrayBuffer);
    } catch (err) {
        return null;
    }
}

const FRASES_BIENVENIDA = [
    "🎉 ¡Qué milagro que te dejas ver! Siéntete como en tu casa, revisa el catálogo y pide sin miedo. 🚀",
    "🔥 ¡Acaba de llegar un nuevo cliente VIP! Pásale a lo barrido y pregunta por tus cuentas favoritas. 🍿",
    "✨ ¡Bienvenido(a) a bordo! Aquí no vendemos humo, puro entretenimiento del bueno. ¡Disfruta tu estancia! 👑",
    "🌮 ¡Pásale, te estábamos esperando! Ponte cómodo(a), checa las promos y cualquier duda aquí andamos al tiro. ⚡"
];

const FRASES_DESPEDIDA = [
    "🛸 Abandonó el barco antes de tiempo. Ni modo, se perdió de las mejores promos. ¡Que la fuerza lo acompañe!",
    "🚪 Salió corriendo del grupo (seguro le dio miedo tanto nivel). ¡Cierren la puerta para que no se meta el frío! 😂",
    "💨 Nos acaba de dejar un integrante. Te extrañaremos (bueno, poquito). ¡Hasta la vista, baby! 🕶️",
    "📉 Baja confirmada en el equipo. ¡Le deseamos éxito y que nunca se le caiga el WiFi! 📡"
];

// ==========================================
// 3. NÚCLEO Y PROCESADOR (OPTIMIZADO PARA 512MB RAM)
// ==========================================
async function iniciarBot() {
    await cargarDB();
    const { state, saveCreds } = await useMultiFileAuthState("auth_session");
    
    // CONFIGURACIÓN ANTI-CRASH PARA RENDER DE $7
    const sock = makeWASocket({ 
        auth: state, 
        logger: pino({ level: "silent" }), 
        printQRInTerminal: true,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        markOnlineOnConnect: false,
        // ESTA ES LA CURA PARA LA RAM: Evita fugas de memoria al citar mensajes antiguos
        getMessage: async (key) => { return { conversation: "MasterBot" }; } 
    });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (update) => {
        const { connection, qr } = update;
        if (qr) { qrActual = qr; botConectado = false; }
        if (connection === "close") setTimeout(iniciarBot, 4000);
        else if (connection === "open") { botConectado = true; qrActual = null; }
    });

    // ==========================================
    // DETECTOR DE ENTRADAS Y SALIDAS
    // ==========================================
    sock.ev.on("group-participants.update", async (anu) => {
        try {
            const chat = anu.id;
            const idFB = chat.split('@')[0]; // Identificador limpio para Firebase
            groupCache.delete(chat); 

            const configB = db.bienvenidas?.[idFB];
            if (!configB) return;

            if (db.licencias?.[idFB] && Date.now() > db.licencias[idFB]) return;
            if (db.candadoEstricto && !db.licencias?.[idFB]) return;

            const metadata = await obtenerMetadataRapida(sock, chat);
            const totalMiembros = metadata.participants ? metadata.participants.length : "VIP";

            let imgBuffer = null;
            if ((anu.action === "add" && configB.welcome) || (anu.action === "remove" && configB.bye)) {
                imgBuffer = await obtenerImagenGrupoOBot(sock, chat);
            }

            for (let p of anu.participants) {
                const userJid = typeof p === 'string' ? p : (p.id || p.jid);
                if (!userJid) continue;
                const tag = `@${userJid.split("@")[0]}`;

                if (anu.action === "add" && configB.welcome) {
                    const fraseRandom = FRASES_BIENVENIDA[Math.floor(Math.random() * FRASES_BIENVENIDA.length)];
                    let mensajeExtra = configB.welcomeMsg 
                        ? configB.welcomeMsg.replace(/@user/gi, tag).replace(/@grupo/gi, metadata.subject)
                        : fraseRandom;

                    const msgFinal = `┏━━━━━━━━━━━━━━━━━━━┓
┃ 🌟 *NUEVO INGRESO VIP*
┣━━━━━━━━━━━━━━━━━━━┫
┃ 👤 *Usuario:* ${tag}
┃ 🛡️ *Grupo:* ${metadata.subject}
┃ 👥 *Miembros:* ${totalMiembros}
┣━━━━━━━━━━━━━━━━━━━┫
💬 ${mensajeExtra}
┗━━━━━━━━━━━━━━━━━━━┛`;

                    if (imgBuffer) {
                        try {
                            await sock.sendMessage(chat, { image: imgBuffer, caption: msgFinal, mentions: [userJid] });
                        } catch (err) {
                            await sock.sendMessage(chat, { text: msgFinal, mentions: [userJid] });
                        }
                    } else {
                        await sock.sendMessage(chat, { text: msgFinal, mentions: [userJid] });
                    }
                }

                if (anu.action === "remove" && configB.bye) {
                    const fraseRandom = FRASES_DESPEDIDA[Math.floor(Math.random() * FRASES_DESPEDIDA.length)];
                    let mensajeExtra = configB.byeMsg 
                        ? configB.byeMsg.replace(/@user/gi, tag).replace(/@grupo/gi, metadata.subject)
                        : fraseRandom;

                    const msgFinal = `┏━━━━━━━━━━━━━━━━━━━┓
┃ 🚪 *REGISTRO DE SALIDA*
┣━━━━━━━━━━━━━━━━━━━┫
┃ 👋 *Usuario:* ${tag}
┃ 🛡️ *Grupo:* ${metadata.subject}
┃ 👥 *Quedan:* ${totalMiembros} miembros
┣━━━━━━━━━━━━━━━━━━━┫
💬 ${mensajeExtra}
┗━━━━━━━━━━━━━━━━━━━┛`;

                    if (imgBuffer) {
                        try {
                            await sock.sendMessage(chat, { image: imgBuffer, caption: msgFinal, mentions: [userJid] });
                        } catch (err) {
                            await sock.sendMessage(chat, { text: msgFinal, mentions: [userJid] });
                        }
                    } else {
                        await sock.sendMessage(chat, { text: msgFinal, mentions: [userJid] });
                    }
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
            const idFB = chat.split('@')[0]; // Identificador limpio para la nube

            if (!texto || !texto.startsWith(".")) return;

            const cuerpoSinPunto = texto.slice(1).trim();
            const primerEspacio = cuerpoSinPunto.search(/\s/);
            let comando = (primerEspacio === -1 ? cuerpoSinPunto : cuerpoSinPunto.slice(0, primerEspacio)).toLowerCase();
            let rawResto = primerEspacio === -1 ? "" : cuerpoSinPunto.slice(primerEspacio).trim();

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
                if (db.creador !== "" && db.creador !== senderId) return responder(`${pre}\n┃ ⚠️ El sistema ya tiene dueño.\n${pie}`);
                db.creador = senderId;
                await guardarDB("creador", db.creador);
                return responder(`${pre}\n┃ 👑 *CREADOR VINCULADO*\n${sep}\n┃ ID: ${senderId.split("@")[0]}\n┃ Control maestro activado.\n${pie}`);
            }

            const isCreator = (db.creador === senderId);

            // ==========================================
            // 2. VERIFICADOR ESTRICTO DE LICENCIAS POR GRUPO
            // ==========================================
            if (esGrupo && !isCreator) {
                const vencimiento = db.licencias?.[idFB];
                if (vencimiento && Date.now() > vencimiento) {
                    return responder(`${pre}\n┃ ⛔ *LICENCIA VENCIDA* ⛔\n${sep}\n┃ El tiempo de renta del bot\n┃ en este grupo ha finalizado.\n┃\n┃ 📲 Contacta al Creador para\n┃ renovar tu activación remota.\n${pie}`);
                }
                if (db.candadoEstricto && !vencimiento) {
                    return responder(`${pre}\n┃ 🔒 *GRUPO SIN LICENCIA* 🔒\n${sep}\n┃ Este grupo aún no tiene una\n┃ licencia activa asignada.\n┃\n┃ 📲 Contacta al Creador para\n┃ activar tu renta mensual.\n${pie}`);
                }
            }

            // ==========================================
            // 3. COMANDOS RESERVADOS
            // ==========================================
            const comandosReservados = [
                "soycreador", "nube", "listagrupos", "licencia", "candado", "activarpin", "desactivarpin",
                "addpin", "delpin", "pin", "extraer", "cerrar", "abrir", "n", "kick", "sacar",
                "link", "tagall", "activar", "desactivar", "bienvenida", "despedida",
                "setbienvenida", "setdespedida", "set", "del", "listacmd", "comandos",
                "play", "musica", "ver", "revelar", "vo", "carrera", "bomba", "casino", "slots", 
                "dado", "ruleta", "suerte", "doxeo", "doxxear", "calentura", "pajero", "lesbiometro",
                "ship", "parejas", "piropo", "menu", "help", "juegos", "entretenimiento"
            ];

            // 3.1 RESPUESTA ULTRA-RÁPIDA DE CATÁLOGOS (.stock, .netflix, etc.)
            if (!comandosReservados.includes(comando)) {
                let itemGuardado = null;
                if (esGrupo && db[idFB]?.comandos && db[idFB].comandos[comando]) {
                    itemGuardado = db[idFB].comandos[comando];
                } else if (db.comandos && db.comandos[comando]) {
                    itemGuardado = db.comandos[comando];
                } else if (esGrupo && db["120363409863908124"]?.comandos?.[comando] && isCreator) {
                    itemGuardado = db["120363409863908124"].comandos[comando];
                }

                if (itemGuardado) {
                    if (typeof itemGuardado === "object" && itemGuardado.image) {
                        const imgBuffer = Buffer.from(itemGuardado.image, 'base64');
                        const cap = itemGuardado.text || "";
                        return await sock.sendMessage(chat, { image: imgBuffer, caption: cap }, { quoted: m });
                    }
                    const txtResp = typeof itemGuardado === "object" ? itemGuardado.text : itemGuardado;
                    if (txtResp.includes("╔═════") || txtResp.includes("┏━━━") || txtResp.includes("━━━")) {
                        return responder(txtResp);
                    }
                    return responder(`┏━━━━━━━━━━━━━━━━━━━┓\n┃ 💡 *INFORMACIÓN*\n┣━━━━━━━━━━━━━━━━━━━┫\n${txtResp}\n┗━━━━━━━━━━━━━━━━━━━┛`);
                }
            }

            // 3.2 REVELADOR DE "VER UNA SOLA VEZ" (.VER)
            if (comando === "ver" || comando === "revelar" || comando === "vo") {
                const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quoted) {
                    return responder(`${pre}\n┃ 👁️ *MODO DE USO (.VER)*\n${sep}\n┃ Responde a una foto o video\n┃ de *"Ver una sola vez"* con\n┃ el comando *.ver*\n${pie}`);
                }

                const voContainer = quoted.viewOnceMessage?.message || quoted.viewOnceMessageV2?.message || quoted.viewOnceMessageV2Extension?.message || quoted;
                const imgMsg = voContainer.imageMessage;
                const vidMsg = voContainer.videoMessage;
                const audMsg = voContainer.audioMessage;

                if (!imgMsg && !vidMsg && !audMsg) {
                    return responder(`${pre}\n┃ ⚠️ Ese mensaje no contiene\n┃ un archivo de una sola vez.\n${pie}`);
                }

                try {
                    if (imgMsg) {
                        const stream = await downloadContentFromMessage(imgMsg, 'image');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                        const cap = `┏━━━━━━━━━━━━━━━━━━━┓\n┃ 👁️ *ARCHIVO REVELADO*\n┗━━━━━━━━━━━━━━━━━━━┛${imgMsg.caption ? `\n\n💬 ${imgMsg.caption}` : ""}`;
                        return await sock.sendMessage(chat, { image: buffer, caption: cap }, { quoted: m });
                    }
                    if (vidMsg) {
                        const stream = await downloadContentFromMessage(vidMsg, 'video');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                        const cap = `┏━━━━━━━━━━━━━━━━━━━┓\n┃ 👁️ *VIDEO REVELADO*\n┗━━━━━━━━━━━━━━━━━━━┛${vidMsg.caption ? `\n\n💬 ${vidMsg.caption}` : ""}`;
                        return await sock.sendMessage(chat, { video: buffer, caption: cap }, { quoted: m });
                    }
                    if (audMsg) {
                        const stream = await downloadContentFromMessage(audMsg, 'audio');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                        return await sock.sendMessage(chat, { audio: buffer, mimetype: 'audio/mp4', ptt: false }, { quoted: m });
                    }
                } catch (e) {
                    return responder(`${pre}\n┃ ❌ El archivo expiró en WA.\n${pie}`);
                }
                return;
            }

            // ==========================================
            // 4. OBTENER PERMISOS DE ADMIN
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
                if (exito) return responder(`${pre}\n┃ ☁️ *FIREBASE CLOUD PRO*\n${sep}\n┃ ✅ Sincronización perfecta.\n┃ Licencias y datos blindados.\n${pie}`);
                else return responder(`${pre}\n┃ ⚠️ Error al conectar con Firebase.\n${pie}`);
            }

            if (comando === "candado" && isCreator) {
                const modo = args[0]?.toLowerCase();
                db.candadoEstricto = (modo === "on" || modo === "activo" || modo === "1");
                await guardarDB("candadoEstricto", db.candadoEstricto);
                return responder(`${pre}\n┃ 🔒 *CANDADO DE LICENCIAS*\n${sep}\n┃ Estado: ${db.candadoEstricto ? "🟢 *ESTRICTO (Bloquea)*" : "⚪ *LIBRE*"}\n${pie}`);
            }

            if (comando === "listagrupos" && isCreator) {
                const grupos = await sock.groupFetchAllParticipating();
                let txt = `┏━━━━━━━━━━━━━━━━━━━┓\n┃ 👑 *PANEL MAESTRO RENTAS*\n┣━━━━━━━━━━━━━━━━━━━┫\n`;
                let i = 1; db.mapaGrupos = {}; 
                for (const jid in grupos) {
                    const localId = jid.split('@')[0];
                    const pinActivo = db.gruposOTP[localId] ? "✅" : "❌";
                    const wActivo = db.bienvenidas?.[localId]?.welcome ? "🟢" : "⚪";
                    let vencimiento = "⚠️ Sin licencia";
                    if (db.licencias && db.licencias[localId]) {
                        const restanteMs = db.licencias[localId] - Date.now();
                        if (restanteMs <= 0) vencimiento = "🔴 VENCIDA";
                        else {
                            const diasRest = Math.ceil(restanteMs / (1000 * 60 * 60 * 24));
                            const fVence = new Date(db.licencias[localId]).toLocaleDateString('es-MX');
                            vencimiento = `🟢 ${diasRest}d (${fVence})`;
                        }
                    }
                    txt += `┃ *${i}.* ${grupos[jid].subject}\n┃  ├ 🔑 OTP: ${pinActivo} | 👋 Bienv: ${wActivo}\n┃  └ 📅 Licencia: ${vencimiento}\n┃\n`;
                    db.mapaGrupos[i] = jid; i++;
                }
                txt += `┗━━━━━━━━━━━━━━━━━━━┛\n⚡ *Comandos Creador:*\n• _.licencia [días] [num]_\n• _.licencia off [num]_\n• _.candado on / off_`;
                await guardarDB("mapaGrupos", db.mapaGrupos);
                return responder(txt);
            }

            if (comando === "licencia" && isCreator) {
                const arg1 = args[0]?.toLowerCase();
                const num = args[1];
                if (!arg1 || !num) return responder(`${pre}\n┃ ⚠️ Uso: .licencia [días] [num]\n${pie}`);
                const jid = db.mapaGrupos?.[num]; 
                if (!jid) return responder(`${pre}\n┃ ⚠️ Número de grupo inválido.\n${pie}`);

                const targetId = jid.split('@')[0];
                if (!db.licencias) db.licencias = {};

                if (arg1 === "off" || arg1 === "0" || arg1 === "cortar") {
                    db.licencias[targetId] = Date.now() - 10000;
                    await guardarDB("licencias", db.licencias);
                    try { await sock.sendMessage(jid, { text: `${pre}\n┃ ⛔ *SISTEMA SUSPENDIDO*\n${sep}\n┃ La licencia de este grupo ha\n┃ finalizado. Contacta al Creador\n┃ para renovar el servicio.\n${pie}` }); } catch(e) {}
                    return responder(`${pre}\n┃ 🔴 *LICENCIA CORTADA*\n┃ El grupo ${num} ha quedado bloqueado.\n${pie}`);
                }

                const dias = parseInt(arg1);
                if (isNaN(dias) || dias <= 0) return responder(`${pre}\n┃ ⚠️ Número de días inválido.\n${pie}`);
                
                db.licencias[targetId] = Date.now() + (dias * 24 * 60 * 60 * 1000);
                await guardarDB("licencias", db.licencias);
                
                if (!db[targetId]) {
                    db[targetId] = { comandos: {} };
                    await guardarDB(targetId, db[targetId]);
                }
                
                const fFin = new Date(db.licencias[targetId]).toLocaleDateString('es-MX');
                try { await sock.sendMessage(jid, { text: `${pre}\n┃ ⚡ *LICENCIA ACTIVADA* ⚡\n${sep}\n┃ 📅 Duración: *${dias} días*\n┃ 🛑 Vence el: *${fFin}*\n${pie}` }); } catch(e) {}
                return responder(`${pre}\n┃ ✅ *LICENCIA OTORGADA*\n┃ Grupo ${num} activo por ${dias} días.\n${pie}`);
            }

            if (comando === "activarpin" && isCreator) {
                const num = args[0]; const jid = db.mapaGrupos?.[num]; if (!jid) return;
                db.gruposOTP[jid.split('@')[0]] = true; await guardarDB("gruposOTP", db.gruposOTP);
                return responder(`${pre}\n┃ ✅ *OTP DESBLOQUEADO*\n┃ Grupo ${num} tiene acceso a PIN.\n${pie}`);
            }

            if (comando === "desactivarpin" && isCreator) {
                const num = args[0]; const jid = db.mapaGrupos?.[num]; if (!jid) return;
                db.gruposOTP[jid.split('@')[0]] = false; await guardarDB("gruposOTP", db.gruposOTP);
                return responder(`${pre}\n┃ ⛔ *OTP BLOQUEADO*\n┃ Permiso revocado al grupo ${num}.\n${pie}`);
            }

            // ==========================================
            // 6. ACTIVAR BIENVENIDA Y COMANDOS
            // ==========================================
            if (comando === "activar" || comando === "desactivar") {
                if (!esGrupo || !esAdmin) return;
                const sub = args[0]?.toLowerCase() || "";
                const encender = comando === "activar";

                if (!db.bienvenidas) db.bienvenidas = {};
                if (!db.bienvenidas[idFB]) db.bienvenidas[idFB] = { welcome: false, bye: false };
                if (!db[idFB]) db[idFB] = { comandos: {} };

                if (sub === "bienvenida" || sub === "welcome") {
                    db.bienvenidas[idFB].welcome = encender;
                    await guardarDB("bienvenidas", db.bienvenidas);
                    return responder(`${pre}\n┃ 👋 *SISTEMA DE BIENVENIDA*\n${sep}\n┃ Estado: ${encender ? "🟢 *ACTIVADO*" : "🔴 *DESACTIVADO*"}\n${pie}`);
                }
                if (sub === "despedida" || sub === "salida" || sub === "bye") {
                    db.bienvenidas[idFB].bye = encender;
                    await guardarDB("bienvenidas", db.bienvenidas);
                    return responder(`${pre}\n┃ 🚪 *SISTEMA DE DESPEDIDA*\n${sep}\n┃ Estado: ${encender ? "🟢 *ACTIVADO*" : "🔴 *DESACTIVADO*"}\n${pie}`);
                }

                await guardarDB(idFB, db[idFB]);
                return responder(`${pre}\n┃ ⚡ *GRUPO INICIALIZADO*\n${sep}\n┃ ✅ Cajón de comandos activo.\n${pie}`);
            }

            if (comando === "bienvenida" || comando === "despedida") {
                if (!esGrupo || !esAdmin) return;
                if (!db.bienvenidas) db.bienvenidas = {};
                if (!db.bienvenidas[idFB]) db.bienvenidas[idFB] = { welcome: false, bye: false };
                const modoOff = args[0]?.toLowerCase() === "off" || args[0]?.toLowerCase() === "apagar";

                if (comando === "bienvenida") {
                    db.bienvenidas[idFB].welcome = !modoOff;
                    await guardarDB("bienvenidas", db.bienvenidas);
                    return responder(`${pre}\n┃ 👋 Bienvenida: ${!modoOff ? "🟢 *ACTIVA*" : "🔴 *APAGADA*"}\n${pie}`);
                } else {
                    db.bienvenidas[idFB].bye = !modoOff;
                    await guardarDB("bienvenidas", db.bienvenidas);
                    return responder(`${pre}\n┃ 🚪 Despedida: ${!modoOff ? "🟢 *ACTIVA*" : "🔴 *APAGADA*"}\n${pie}`);
                }
            }

            if (comando === "setbienvenida" && esGrupo && esAdmin) {
                if (!rawResto) return responder(`${pre}\n┃ ⚠️ Escribe el mensaje.\n${pie}`);
                if (!db.bienvenidas) db.bienvenidas = {};
                if (!db.bienvenidas[idFB]) db.bienvenidas[idFB] = { welcome: true, bye: false };
                db.bienvenidas[idFB].welcome = true;
                db.bienvenidas[idFB].welcomeMsg = rawResto;
                await guardarDB("bienvenidas", db.bienvenidas);
                return responder(`${pre}\n┃ ✅ Bienvenida personalizada lista.\n${pie}`);
            }

            if (comando === "setdespedida" && esGrupo && esAdmin) {
                if (!rawResto) return responder(`${pre}\n┃ ⚠️ Escribe el mensaje de salida.\n${pie}`);
                if (!db.bienvenidas) db.bienvenidas = {};
                if (!db.bienvenidas[idFB]) db.bienvenidas[idFB] = { welcome: false, bye: true };
                db.bienvenidas[idFB].bye = true;
                db.bienvenidas[idFB].byeMsg = rawResto;
                await guardarDB("bienvenidas", db.bienvenidas);
                return responder(`${pre}\n┃ ✅ Despedida personalizada lista.\n${pie}`);
            }

            if (comando === "set" && esAdmin) {
                const espacioNombre = rawResto.search(/\s/);
                const nCmd = (espacioNombre === -1 ? rawResto : rawResto.slice(0, espacioNombre)).toLowerCase().replace(/^\./, "");
                let contenidoTexto = espacioNombre === -1 ? "" : rawResto.slice(espacioNombre).trim();

                if (!nCmd) return responder(`${pre}\n┃ ⚠️ Uso: .set [nombre] [texto]\n${pie}`);

                const quotedMsg = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                const imgMsg = m.message.imageMessage || quotedMsg?.imageMessage;

                if (!contenidoTexto && quotedMsg) {
                    contenidoTexto = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || quotedMsg.imageMessage?.caption || "";
                }

                let imgBase64 = null;
                if (imgMsg) imgBase64 = await descargarImagenBase64(imgMsg);

                if (!contenidoTexto && !imgBase64) return responder(`${pre}\n┃ ⚠️ Debes escribir un texto o adjuntar imagen.\n${pie}`);

                const objetoGuardar = imgBase64 ? { text: contenidoTexto, image: imgBase64 } : contenidoTexto;

                if (esGrupo) {
                    if (!db[idFB]) db[idFB] = { comandos: {} };
                    if (!db[idFB].comandos) db[idFB].comandos = {};
                    db[idFB].comandos[nCmd] = objetoGuardar;
                    await guardarDB(idFB, db[idFB]);
                } else {
                    db.comandos[nCmd] = objetoGuardar;
                    await guardarDB("comandos", db.comandos);
                }

                return responder(`${pre}\n┃ ✅ *COMANDO GUARDADO*\n${sep}\n┃ 🏷️ Atajo: *.${nCmd}*\n${pie}`);
            }

            if (comando === "del" && esAdmin) {
                const nCmd = args[0]?.toLowerCase().replace(/^\./, "");
                if (!nCmd) return responder(`${pre}\n┃ ⚠️ Uso: .del [nombre]\n${pie}`);
                if (esGrupo && db[idFB]?.comandos && db[idFB].comandos[nCmd]) {
                    delete db[idFB].comandos[nCmd];
                    await guardarDB(idFB, db[idFB]);
                } else if (!esGrupo && db.comandos[nCmd]) {
                    delete db.comandos[nCmd];
                    await guardarDB("comandos", db.comandos);
                } else {
                    return responder(`${pre}\n┃ ⚠️ El comando .${nCmd} no existe.\n${pie}`);
                }
                return responder(`${pre}\n┃ 🗑️ Comando *.${nCmd}* eliminado.\n${pie}`);
            }

            if (comando === "listacmd" || comando === "comandos") {
                const cmdsGrupo = esGrupo && db[idFB]?.comandos ? Object.keys(db[idFB].comandos) : [];
                const cmdsGlobal = db.comandos ? Object.keys(db.comandos) : [];
                const todos = [...new Set([...cmdsGrupo, ...cmdsGlobal])];
                if (todos.length === 0) return responder(`${pre}\n┃ 📭 No hay comandos guardados.\n${pie}`);
                
                let listaTxt = `┏━━━━━━━━━━━━━━━━━━━┓\n┃ 📂 *COMANDOS GUARDADOS*\n┣━━━━━━━━━━━━━━━━━━━┫\n`;
                todos.forEach(c => {
                    const item = (esGrupo && db[idFB]?.comandos?.[c]) || db.comandos[c];
                    const icono = (typeof item === "object" && item.image) ? "📸" : "📝";
                    listaTxt += `┃ ${icono} *.${c}*\n`;
                });
                listaTxt += `┗━━━━━━━━━━━━━━━━━━━┛`;
                return responder(listaTxt);
            }

            // ==========================================
            // 7. AUDIO, ENTRETENIMIENTO Y MODERACIÓN
            // ==========================================
            if (comando === "play" || comando === "musica") {
                if (!rawResto) return responder(`${pre}\n┃ 🎵 Uso: *.play [canción]*\n${pie}`);
                await responder(`${pre}\n┃ 🎧 *Buscando:* _${rawResto}_...\n${pie}`);
                try {
                    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(rawResto)}&media=music&limit=1`);
                    const data = await res.json();
                    if (!data.results || data.results.length === 0) return responder(`${pre}\n┃ ❌ Canción no encontrada.\n${pie}`);
                    const track = data.results[0];
                    const portadaAltaRes = track.artworkUrl100 ? track.artworkUrl100.replace("100x100bb", "600x600bb") : null;
                    const duracionMin = track.trackTimeMillis ? `${Math.floor(track.trackTimeMillis / 60000)}:${String(Math.floor((track.trackTimeMillis % 60000) / 1000)).padStart(2, '0')}` : "N/A";
                    const infoCancion = `┏━━━━━━━━━━━━━━━━━━━┓\n┃ 🎶 *MASTER MUSIC PLAYER*\n┣━━━━━━━━━━━━━━━━━━━┫\n┃ 🎵 *Título:* ${track.trackName}\n┃ 🎤 *Artista:* ${track.artistName}\n┃ ⏱️ *Duración:* ${duracionMin} mins\n┗━━━━━━━━━━━━━━━━━━━┛\n_⬇️ Enviando pista..._`;
                    if (portadaAltaRes) await sock.sendMessage(chat, { image: { url: portadaAltaRes }, caption: infoCancion }, { quoted: m });
                    else await responder(infoCancion);
                    if (track.previewUrl) {
                        const audioRes = await fetch(track.previewUrl);
                        const arrayBuffer = await audioRes.arrayBuffer();
                        await sock.sendMessage(chat, { audio: Buffer.from(arrayBuffer), mimetype: 'audio/mp4', ptt: false, fileName: `${track.trackName}.m4a` }, { quoted: m });
                    }
                } catch (e) { return responder(`${pre}\n┃ ⚠️ Error al descargar.\n${pie}`); }
                return;
            }

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
                    } else return responder(`${pre}\n┃ ⚠️ Uso: .${comando} 5m, 1h, 30s\n${pie}`);
                }

                if (delayMs > 0) {
                    const cDate = new Date(Date.now() + delayMs);
                    const tFormat = cDate.toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute:'2-digit' });
                    const msg = `${pre}\n┃ ⏳ *TEMPORIZADOR ACTIVO*\n${sep}\n┃ 👤 Admin: @${senderId.split("@")[0]}\n┃ ⏳ Se ${esCerrar ? "cerrará" : "abrirá"} en: *${timeStr}*\n┃ 🕒 Hora exacta: ${tFormat} (MX)\n${pie}`;
                    await sock.sendMessage(chat, { text: msg, mentions: [senderId] }, { quoted: m });
                    setTimeout(async () => {
                        try {
                            await sock.groupSettingUpdate(chat, accionConfig);
                            await sock.sendMessage(chat, { text: `${pre}\n┃ 🛡️ *SEGURIDAD DEL GRUPO*\n${sep}\n┃ 🔐 ESTADO: ${esCerrar ? "CERRADO 🔴" : "ABIERTO 🟢"}\n${pie}\n_Temporizador completado._` });
                        } catch (e) {}
                    }, delayMs);
                    return;
                }

                try {
                    await sock.groupSettingUpdate(chat, accionConfig);
                    await sock.sendMessage(chat, { text: `${pre}\n┃ 🛡️ *SEGURIDAD DEL GRUPO*\n${sep}\n┃ 🔐 ESTADO: ${esCerrar ? "CERRADO 🔴" : "ABIERTO 🟢"}\n${pie}` });
                } catch (error) { return responder(`${pre}\n┃ ❌ Necesito ser Admin del grupo.\n${pie}`); }
                return;
            }

            if (comando === "n") {
                if (!esGrupo || !esAdmin) return;
                let txtMsg = rawResto;
                let isQuoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!txtMsg && isQuoted) { txtMsg = isQuoted.conversation || isQuoted.extendedTextMessage?.text || isQuoted.imageMessage?.caption || isQuoted.videoMessage?.caption || ""; }
                if (!txtMsg && !isQuoted && !m.message.imageMessage && !m.message.videoMessage) return responder(`${pre}\n┃ ⚠️ Escribe o responde a un mensaje.\n${pie}`);
                
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
                if (!target) return responder(`${pre}\n┃ ⚠️ Etiqueta o responde al usuario.\n${pie}`);
                if (target === db.creador) return responder(`${pre}\n┃ 🛡️ Prohibido expulsar al Creador.\n${pie}`);
                try {
                    await sock.groupParticipantsUpdate(chat, [target], "remove");
                    groupCache.delete(chat);
                    return responder(`${pre}\n┃ 👢 Usuario expulsado del grupo.\n${pie}`);
                } catch (e) { return responder(`${pre}\n┃ ❌ No pude expulsarlo (verifica mi admin).\n${pie}`); }
            }

            if (comando === "link") {
                if (!esGrupo || !esAdmin) return;
                try {
                    const code = await sock.groupInviteCode(chat);
                    return responder(`${pre}\n┃ 🔗 *LINK DE INVITACIÓN*\n┃ https://chat.whatsapp.com/${code}\n${pie}`);
                } catch (e) { return responder(`${pre}\n┃ ❌ Necesito ser Admin para ver el link.\n${pie}`); }
            }

            if (comando === "tagall") {
                if (!esGrupo || !esAdmin) return;
                let msgTag = `┏━━━━━━━━━━━━━━━━━━━┓\n┃ 📢 *ATENCIÓN MIEMBROS*\n┣━━━━━━━━━━━━━━━━━━━┫\n`;
                const menciones = groupMetadata.participants.map(p => { msgTag += `┃ ⚡ @${p.id.split("@")[0]}\n`; return p.id; });
                msgTag += `┗━━━━━━━━━━━━━━━━━━━┛`;
                await sock.sendMessage(chat, { text: msgTag, mentions: menciones });
                return;
            }

            if (comando === "carrera") {
                const msg = await sock.sendMessage(chat, { text: `${pre}\n┃ 🏁 Preparando motores...\n${pie}` }, { quoted: m });
                const frames = [
                    `${pre}\n┃ 🏁 *ARRANCA LA CARRERA*\n${sep}\n┃ 🚗💨          🏎️💨\n${pie}`,
                    `${pre}\n┃ 🏁 *MITAD DE PISTA*\n${sep}\n┃     🚗💨    🏎️💨\n${pie}`,
                    `${pre}\n┃ 🏁 *RECTA FINAL*\n${sep}\n┃             🚗💨🏎️💨\n┃ 🏆 ¡GANÓ EL AUTO ROJO!\n${pie}`
                ];
                for (let i = 0; i < frames.length; i++) {
                    await new Promise(r => setTimeout(r, 1000));
                    await sock.sendMessage(chat, { edit: msg.key, text: frames[i] });
                }
                return;
            }

            if (comando === "bomba") {
                const msg = await sock.sendMessage(chat, { text: `${pre}\n┃ 💣 *BOMBA ACTIVADA: 3...*\n${pie}` }, { quoted: m });
                await new Promise(r => setTimeout(r, 1000));
                await sock.sendMessage(chat, { edit: msg.key, text: `${pre}\n┃ 💣 *BOMBA ACTIVADA: 2...*\n${pie}` });
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
                return responder(`${pre}\n┃ 🎰 *CASINO MASTER VIP* 🎰\n${sep}\n┃      [ ${r1} | ${r2} | ${r3} ]\n${sep}\n┃ ${win}\n${pie}`);
            }

            if (comando === "dado") {
                const cara = Math.floor(Math.random() * 6) + 1;
                return responder(`${pre}\n┃ 🎲 El dado giró y cayó en: *${cara}* ✅\n${pie}`);
            }

            if (comando === "ruleta") {
                if (!esGrupo) return;
                if (esAdmin) return responder(`${pre}\n┃ 🛡️ Los Admins son inmortales.\n${pie}`);
                if (Math.floor(Math.random() * 6) + 1 === 1) {
                    await responder(`${pre}\n┃ 🔫 *¡BANG!* 💥 Te tocó la bala...\n${pie}`);
                    try { await sock.groupParticipantsUpdate(chat, [senderId], "remove"); groupCache.delete(chat); } catch(e) {}
                } else {
                    return responder(`${pre}\n┃ 🔫 *Click...* Tambor vacío, vives un día más. 😅\n${pie}`);
                }
                return;
            }

            if (comando === "suerte") {
                return responder(`${pre}\n┃ 🍀 Hoy tienes un *${Math.floor(Math.random() * 101)}%* de suerte.\n${pie}`);
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
                    text: `${pre}\n┃ ☠️ *REPORTE DE DOXEO* ☠️\n${sep}\n┃ 👤 Objetivo: ${tag}\n┃ 🌐 IP: ${ip}\n┃ 📍 Ubicación: ${locs[Math.floor(Math.random()*locs.length)]}\n┃ 📡 Red: ${isps[Math.floor(Math.random()*isps.length)]}\n┃ 📱 Equipo: ${devices[Math.floor(Math.random()*devices.length)]}\n┃ 🕵️ *Archivo confidencial:*\n┃ › ${secrets[Math.floor(Math.random()*secrets.length)]}\n${pie}`, 
                    mentions: target ? [target] : [] 
                }, { quoted: m });
            }

            if (comando === "calentura" || comando === "pajero" || comando === "lesbiometro") {
                let target = m.message.extendedTextMessage?.contextInfo?.participant || m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                let tag = target ? `@${target.split("@")[0]}` : "este usuario";
                const nivel = Math.floor(Math.random() * 101);
                let diag = nivel > 80 ? "🔥 ¡Nivel crítico, échenle agua fría!" : nivel > 40 ? "😏 Nivel moderado, sabe cosas." : "🧊 Más frío que el corazón de tu ex.";
                return await sock.sendMessage(chat, { text: `${pre}\n┃ 🌡️ *ESCÁNER: ${comando.toUpperCase()}*\n${sep}\n┃ 👤 Sujeto: ${tag}\n┃ 📊 Resultado: *${nivel}%*\n┃ 🩺 Diagnóstico: ${diag}\n${pie}`, mentions: target ? [target] : [] }, { quoted: m });
            }

            if (comando === "ship" || comando === "parejas") {
                if (!esGrupo) return;
                const miembros = groupMetadata.participants.map(p => p.id);
                if (miembros.length < 2) return;
                const u1 = miembros[Math.floor(Math.random() * miembros.length)];
                const u2 = miembros[Math.floor(Math.random() * miembros.length)];
                const porc = Math.floor(Math.random() * 101);
                return await sock.sendMessage(chat, { text: `${pre}\n┃ 💘 *FLECHAZO EN EL GRUPO*\n${sep}\n┃ ❤️ @${u1.split("@")[0]}\n┃ ❤️ @${u2.split("@")[0]}\n┃ 📊 Compatibilidad: *${porc}%*\n┃\n┃ _¡Que inviten a la boda!_ 🥂\n${pie}`, mentions: [u1, u2] }, { quoted: m });
            }

            if (comando === "piropo") {
                const piropos = [
                    "Si la belleza fuera pecado, tú ya no tendrías perdón de Dios. 😘",
                    "No eres Google, pero tienes todo lo que ando buscando. 😉",
                    "Quien fuera cargador para darte energía todo el día. ⚡",
                    "Estás como para invitarte unos tacos y no cobrarte la cuenta. 🌮"
                ];
                return responder(`${pre}\n┃ 😏 ${piropos[Math.floor(Math.random() * piropos.length)]}\n${pie}`);
            }

            if (comando === "menu" || comando === "help") {
                const fch = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'short' });
                let estadoLic = "🟢 Activa";
                if (esGrupo && db.licencias?.[idFB]) {
                    const rest = Math.ceil((db.licencias[idFB] - Date.now()) / (1000 * 60 * 60 * 24));
                    estadoLic = rest > 0 ? `🟢 ${rest} días` : "🔴 Vencida";
                }

                let menuTxt = `┏━━━━━━━━━━━━━━━━━━━┓
┃ ⚡ *MASTER SYSTEM PRO* ⚡
┃ 🕒 ${fch}
┃ 🛡️ Licencia: ${estadoLic}
┣━━━━━━━━━━━━━━━━━━━┫
┃ 📦 *CATÁLOGO Y MULTIMEDIA*
┃  ├ *.set* [cmd] [texto/foto]
┃  ├ *.del* [cmd]
┃  ├ *.listacmd* (Ver lista)
┃  ├ *.ver* (Revelar 1 vez)
┃  └ *.play* [canción]
┃
┃ 🔐 *EXTRACTOR OTP*
┃  └ *.pin* [plat] [correo]
┃
┃ 👋 *BIENVENIDA / SALIDA*
┃  ├ *.activar bienvenida*
┃  ├ *.activar despedida*
┃  ├ *.desactivar bienvenida*
┃  └ *.desactivar despedida*
┃
┃ ⚙️ *MODERACIÓN*
┃  ├ *.cerrar* [5m] / *.abrir*
┃  ├ *.n* [aviso global]
┃  ├ *.kick* / *.tagall*
┃  └ *.link*
┃
┃ 🎮 *ENTRETENIMIENTO*
┃  └ *.juegos* (Ver catálogo)
┗━━━━━━━━━━━━━━━━━━━┛`;
                
                if (isCreator) {
                    menuTxt += `\n\n┏━━━━━━━━━━━━━━━━━━━┓
┃ 👑 *PANEL CREADOR*
┣━━━━━━━━━━━━━━━━━━━┫
┃  ├ *.listagrupos*
┃  ├ *.licencia* [días] [num]
┃  ├ *.licencia off* [num]
┃  ├ *.candado on / off*
┃  ├ *.activarpin* / *.desactivarpin*
┃  ├ *.addpin* / *.delpin* [@user]
┃  └ *.nube* (Status Firebase)
┗━━━━━━━━━━━━━━━━━━━┛`;
                }
                
                const imgMenuBuffer = esGrupo 
                    ? await obtenerImagenGrupoOBot(sock, chat) 
                    : await obtenerImagenGrupoOBot(sock, jidNormalizedUser(sock.user.id));

                if (imgMenuBuffer) {
                    try { 
                        await sock.sendMessage(chat, { image: imgMenuBuffer, caption: menuTxt }, { quoted: m }); 
                        return;
                    } catch(e) {}
                }
                await sock.sendMessage(chat, { text: menuTxt }, { quoted: m });
                return;
            }

            if (comando === "juegos" || comando === "entretenimiento") {
                return responder(`┏━━━━━━━━━━━━━━━━━━━┓
┃ 🎮 *CATÁLOGO DE JUEGOS*
┣━━━━━━━━━━━━━━━━━━━┫
┃  ├ 🏎️ *.carrera*
┃  ├ 💣 *.bomba*
┃  ├ 🎰 *.casino*
┃  ├ 🎲 *.dado*
┃  ├ 🔫 *.ruleta*
┃  ├ 🍀 *.suerte*
┃  ├ ☠️ *.doxeo* [@user]
┃  ├ 💘 *.parejas*
┃  ├ 🌡️ *.calentura* [@user]
┃  ├ 😏 *.piropo*
┃  ├ 👁️ *.ver* (Revelar 1 vez)
┃  └ 🎵 *.play* [canción]
┗━━━━━━━━━━━━━━━━━━━┛`);
            }

        } catch (error) { console.error("Error procesando mensaje:", error); }
    });
}

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

iniciarBot();
