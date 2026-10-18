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
    gruposComandos: {}, 
    gruposOTP: {}, 
    mapaGrupos: {}, 
    licencias: {}, 
    pinUsers: {}, 
    tiendasActivas: {}, 
    tiendasData: {}, 
    creador: "", 
    pausado: false 
};

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
                        db.gruposComandos = data.gruposComandos || {};
                        db.gruposOTP = data.gruposOTP || {};
                        db.mapaGrupos = data.mapaGrupos || {};
                        db.licencias = data.licencias || {};
                        db.pinUsers = data.pinUsers || {}; 
                        db.tiendasActivas = data.tiendasActivas || {};
                        db.tiendasData = data.tiendasData || {};
                        db.creador = data.creador || ""; 
                        for (let key in data) {
                            if (!['comandos', 'gruposComandos', 'gruposOTP', 'mapaGrupos', 'licencias', 'pinUsers', 'tiendasActivas', 'tiendasData', 'creador', 'pausado'].includes(key)) {
                                db[key] = data[key];
                            }
                        }
                    }
                    console.log("✅ Base de datos cargada desde la nube.");
                    resolve();
                } catch (e) { resolve(); }
            });
        }).on('error', () => resolve());
    });
}

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
    if (botConectado) return res.send(`<h1 style="color: #00ff00; background: #000; text-align: center; padding: 50px; font-family: monospace;">✅ MASTER SYSTEM PRO [ONLINE]</h1>`);
    if (qrActual) {
        try {
            const qrImage = await QRCode.toDataURL(qrActual);
            return res.send(`<div style="text-align: center; margin-top: 30px;"><h2>⚡ ESCANEAR ACCESO ⚡</h2><img src="${qrImage}" style="width: 280px; border: 2px solid #333;" /><script>setTimeout(() => location.reload(), 15000);</script></div>`);
        } catch (e) { return res.send("Generando nodo..."); }
    }
    res.send("Iniciando módulos...");
});
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));

// ==========================================
// 2. DISEÑO VISUAL Y MAPA DE PINS OFICIALES
// ==========================================
const pre = "╔══════════════════════════╗\n║ 👑 *MASTER PRO*\n╠══════════════════════════╣";
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

function asegurarTiendaGrupo(jid) {
    if (!db.tiendasData) db.tiendasData = {};
    if (!db.tiendasData[jid]) db.tiendasData[jid] = { usuarios: {}, productos: {} };
    if (!db.tiendasData[jid].usuarios) db.tiendasData[jid].usuarios = {};
    if (!db.tiendasData[jid].productos) db.tiendasData[jid].productos = {};
}

// 🔢 TUS PINES OFICIALES (EXCLUSIVOS PARA NETFLIX Y MAX)
const MAPA_PINS = {
    1: "1010",
    2: "2002",
    3: "0303",
    4: "0004",
    5: "5000",
    6: "6006",
    7: "7007"
};

// 🛒 CATÁLOGO MASTER-STREAMING OFICIAL
const CATALOGO_BASE = {
    "netflix": { nombre: "🃏 Netflix Perfil", precio: 50, dias: 30, garantia: 30, tipo: "cuenta" },
    "netflixpriv": { nombre: "🃏 Netflix Privado", precio: 50, dias: 30, garantia: 30, tipo: "cuenta" },
    "netflixcomp": { nombre: "🃏 Netflix Completa", precio: 240, dias: 30, garantia: 30, tipo: "cuenta" },
    "disney": { nombre: "🥇 Disney ESPN Perfil", precio: 30, dias: 30, garantia: 30, tipo: "cuenta" },
    "disneycomp": { nombre: "🥇 Disney ESPN Completa", precio: 199, dias: 30, garantia: 30, tipo: "cuenta" },
    "max": { nombre: "🎭 Max Hulu Perfil", precio: 10, dias: 30, garantia: 30, tipo: "cuenta" },
    "maxcomp": { nombre: "🎭 Max Hulu Completa", precio: 35, dias: 30, garantia: 30, tipo: "cuenta" },
    "universal": { nombre: "🌎 Universal+ Perfil", precio: 10, dias: 30, garantia: 30, tipo: "cuenta" },
    "universalcomp": { nombre: "🌎 Universal+ Completa", precio: 25, dias: 30, garantia: 30, tipo: "cuenta" },
    "appletv": { nombre: "🍎 Apple TV Perfil", precio: 10, dias: 30, garantia: 30, tipo: "cuenta" },
    "appletvcomp": { nombre: "🍎 Apple TV Completa", precio: 25, dias: 30, garantia: 30, tipo: "cuenta" },
    "peacock": { nombre: "🎬 Peacock Perfil", precio: 10, dias: 30, garantia: 30, tipo: "cuenta" },
    "peacockcomp": { nombre: "🎬 Peacock Completa", precio: 25, dias: 30, garantia: 30, tipo: "cuenta" },
    "fox": { nombre: "⚽ Fox One Dispositivo", precio: 10, dias: 30, garantia: 30, tipo: "cuenta" },
    "foxcomp": { nombre: "⚽ Fox One Completa", precio: 35, dias: 30, garantia: 30, tipo: "cuenta" },
    "paramount": { nombre: "⭐ Paramount Perfil (1m)", precio: 10, dias: 30, garantia: 30, tipo: "cuenta" },
    "paramountcomp": { nombre: "⭐ Paramount Completa (1m)", precio: 40, dias: 30, garantia: 30, tipo: "cuenta" },
    "crunchy": { nombre: "🌸 Crunchyroll Perfil (1m)", precio: 10, dias: 30, garantia: 30, tipo: "cuenta" },
    "crunchycomp": { nombre: "🌸 Crunchyroll Completa (1m)", precio: 40, dias: 30, garantia: 30, tipo: "cuenta" },
    "vix": { nombre: "🔥 Vix Perfil (1m)", precio: 3, dias: 30, garantia: 30, tipo: "cuenta" },
    "vixcomp": { nombre: "🔥 Vix Completa (1m)", precio: 10, dias: 30, garantia: 30, tipo: "cuenta" },
    "vixanual": { nombre: "🔥 Vix Perfil (Anual)", precio: 10, dias: 365, garantia: 365, tipo: "cuenta" },
    "vixanualcomp": { nombre: "🔥 Vix Completa (Anual)", precio: 35, dias: 365, garantia: 365, tipo: "cuenta" },
    "spotify": { nombre: "🎼 Spotify Ind. (1m)", precio: 39, dias: 30, garantia: 30, tipo: "cuenta" },
    "applemusic": { nombre: "🎼 Apple Music Ind. (1m)", precio: 20, dias: 30, garantia: 30, tipo: "cuenta" },
    "deezer": { nombre: "🎼 Deezer Individual", precio: 5, dias: 30, garantia: 30, tipo: "cuenta" },
    "deezerfam": { nombre: "🎼 Deezer Familiar", precio: 8, dias: 30, garantia: 30, tipo: "cuenta" },
    "ytind": { nombre: "🔴 YouTube Ind. (A tus datos)", precio: 15, dias: 30, garantia: 30, tipo: "datos" },
    "ytfam": { nombre: "🔴 YouTube Fam. (A tus datos)", precio: 25, dias: 30, garantia: 30, tipo: "datos" },
    "canva1m": { nombre: "🖌 Canva Edu Pro (1 Mes)", precio: 1, dias: 30, garantia: 30, tipo: "invitacion" },
    "canva2m": { nombre: "🖌 Canva Edu Pro (2 Meses)", precio: 2, dias: 60, garantia: 60, tipo: "invitacion" },
    "canva3m": { nombre: "🖌 Canva Edu Pro (3 Meses)", precio: 3, dias: 90, garantia: 90, tipo: "invitacion" },
    "canva6m": { nombre: "🖌 Canva Edu Pro (6 Meses)", precio: 6, dias: 180, garantia: 180, tipo: "invitacion" },
    "canva12m": { nombre: "🖌 Canva Edu Pro (12 Meses)", precio: 12, dias: 365, garantia: 365, tipo: "invitacion" },
    "canva24m": { nombre: "🖌 Canva Edu Pro (24 Meses)", precio: 24, dias: 730, garantia: 730, tipo: "invitacion" },
    "canva36m": { nombre: "🖌 Canva Edu Pro (36 Meses)", precio: 36, dias: 1095, garantia: 1095, tipo: "invitacion" },
    "canvaperm": { nombre: "🖌 Canva Edu Pro (Permanente)", precio: 60, dias: 365, garantia: 365, tipo: "invitacion" },
    "officeanual": { nombre: "📚 Office 365 Anual (Compartida)", precio: 50, dias: 365, garantia: 365, tipo: "cuenta" },
    "officeanualcomp": { nombre: "📚 Office 365 Anual (Completa)", precio: 150, dias: 365, garantia: 365, tipo: "cuenta" },
    "capcut": { nombre: "🎥 CapCut Pro (Dispositivo)", precio: 25, dias: 30, garantia: 30, tipo: "cuenta" }
};

// ==========================================
// 3. NÚCLEO Y PROCESADOR DE COMANDOS
// ==========================================
async function iniciarBot() {
    await cargarDB();
    const { state, saveCreds } = await useMultiFileAuthState("auth_session");
    const sock = makeWASocket({ auth: state, logger: pino({ level: "silent" }), printQRInTerminal: true });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) { qrActual = qr; botConectado = false; }
        if (connection === "close") setTimeout(iniciarBot, 5000);
        else if (connection === "open") { botConectado = true; qrActual = null; }
    });

    sock.ev.on("messages.upsert", async (chatUpdate) => {
        try {
            if (!chatUpdate.messages) return;
            const m = chatUpdate.messages[0];
            if (!m.message || m.key.fromMe) return;

            const texto = obtenerTextoMensaje(m);
            const chat = m.key.remoteJid;
            if (!texto || !texto.startsWith(".")) return;

            const args = texto.slice(1).trim().split(/ +/);
            const comando = args.shift().toLowerCase();
            const esGrupo = chat.endsWith("@g.us");

            const responder = async (txt, mentions = []) => await sock.sendMessage(chat, { text: txt, mentions }, { quoted: m });
            const senderId = m.key.participant || chat;

            // ==========================================
            // AUTO-REGISTRO DEL CREADOR
            // ==========================================
            if (comando === "soycreador") {
                if (db.creador !== "" && db.creador !== senderId) return responder(`${pre}\n║ ⚠️ El bot ya tiene un dueño.\n${pie}`);
                db.creador = senderId;
                await guardarDB();
                return responder(`╔══════════════════════════╗\n║ 👑 *CREADOR RECONOCIDO*\n╠══════════════════════════╣\n║ Se ha vinculado tu ID:\n║ ${senderId.split("@")[0]}\n║\n║ Tienes control absoluto.\n╚══════════════════════════╝`);
            }

            const isCreator = (db.creador === senderId);

            let esAdmin = false;
            let groupMetadata = null;
            if (esGrupo) {
                groupMetadata = await sock.groupMetadata(chat);
                const senderObj = groupMetadata.participants.find(p => p.id === senderId);
                esAdmin = senderObj?.admin === 'admin' || senderObj?.admin === 'superadmin' || isCreator;
            }

            // SISTEMA DE LICENCIAS (BLOQUEADOR POR VENCIMIENTO)
            if (esGrupo && !isCreator && comando !== "menu" && comando !== "nube") {
                const vencimiento = db.licencias?.[chat];
                if (vencimiento && Date.now() > vencimiento) {
                    return responder(`${pre}\n║ ⛔ *LICENCIA VENCIDA*\n║ Tu renta de sistema finalizó.\n║ Contacta al Creador para renovar.\n${pie}`);
                }
            }

            // ==========================================
            // CAPA VIP: PANEL SECRETO DEL CREADOR
            // ==========================================
            if (comando === "nube" && isCreator) {
                const exito = await guardarDB();
                if (exito) return responder(`╔══════════════════════════╗\n║ ☁️ *ESTADO DE LA NUBE*\n╠══════════════════════════╣\n║ ✅ Conexión Excelente.\n║ Tiendas, saldos y stocks están\n║ blindados en Firebase.\n╚══════════════════════════╝`);
                else return responder(`${pre}\n║ ⚠️ Problemas con Firebase.\n${pie}`);
            }

            if (comando === "listagrupos" && isCreator) {
                const grupos = await sock.groupFetchAllParticipating();
                let txt = `╔══════════════════════════╗\n║ 👑 *PANEL DE RENTAS*\n╠══════════════════════════╣\n`;
                let i = 1; db.mapaGrupos = {}; 
                for (const jid in grupos) {
                    const pinActivo = db.gruposOTP?.[jid] ? "✅ SI" : "❌ NO";
                    const tiendaActiva = db.tiendasActivas?.[jid] ? "🏪 SI" : "❌ NO";
                    let vencimiento = "Sin licencia";
                    if (db.licencias?.[jid]) {
                        const date = new Date(db.licencias[jid]);
                        vencimiento = Date.now() > db.licencias[jid] ? "⚠️ VENCIDA" : date.toLocaleDateString('es-MX');
                    }
                    txt += `║ *${i}.* ${grupos[jid].subject}\n║  ├ 🔑 PIN: ${pinActivo} | 🛒 Tienda: ${tiendaActiva}\n║  └ 📅 Vence: ${vencimiento}\n║\n`;
                    db.mapaGrupos[i] = jid; i++;
                }
                txt += `╚══════════════════════════╝\n_Usa .licencia [días] [num]_\n_Usa .activartienda [num]_\n_Usa .activarpin [num]_`;
                await guardarDB();
                return responder(txt);
            }

            if (comando === "licencia" && isCreator) {
                const dias = parseInt(args[0]); const num = args[1];
                if (!dias || !num) return responder(`${pre}\n║ ⚠️ Uso: .licencia [días] [num]\n${pie}`);
                const jid = db.mapaGrupos?.[num]; if (!jid) return responder(`${pre}\n║ ⚠️ Grupo inválido.\n${pie}`);
                
                db.licencias[jid] = Date.now() + (dias * 24 * 60 * 60 * 1000);
                if (!db.gruposComandos[jid]) db.gruposComandos[jid] = {};
                await guardarDB();
                
                try { await sock.sendMessage(jid, { text: `╔══════════════════════════╗\n║ 🤖 *SISTEMA ACTIVADO*\n╠══════════════════════════╣\n║ ✅ El Creador ha activado\n║ este bot remotamente.\n║ 📅 Licencia: ${dias} días.\n║\n║ Ya pueden usar .menu\n╚══════════════════════════╝` }); } catch(e) {}
                return responder(`${pre}\n║ ✅ *LICENCIA ACTIVADA*\n║ Grupo ${num} tiene ${dias} días.\n║ (El bot ya avisó allá).\n${pie}`);
            }

            if (comando === "activartienda" && isCreator) {
                const num = args[0];
                const jid = num ? db.mapaGrupos?.[num] : (esGrupo ? chat : null);
                if (!jid) return responder(`${pre}\n║ ⚠️ Uso: .activartienda [num_grupo]\n${pie}`);
                
                if (!db.tiendasActivas) db.tiendasActivas = {};
                db.tiendasActivas[jid] = true;
                asegurarTiendaGrupo(jid);
                await guardarDB();

                try { await sock.sendMessage(jid, { text: `╔══════════════════════════╗\n║ 🏪 *TIENDA VIRTUAL ACTIVA*\n╠══════════════════════════╣\n║ ✅ El módulo de tienda y\n║ entregas automáticas ha sido\n║ habilitado en este grupo.\n║\n║ Usa *.tienda* o *.guiatienda*\n╚══════════════════════════╝` }); } catch(e) {}
                return responder(`${pre}\n║ ✅ *TIENDA HABILITADA*\n║ Grupo activado con éxito.\n${pie}`);
            }

            if (comando === "desactivartienda" && isCreator) {
                const num = args[0];
                const jid = num ? db.mapaGrupos?.[num] : (esGrupo ? chat : null);
                if (!jid) return responder(`${pre}\n║ ⚠️ Uso: .desactivartienda [num_grupo]\n${pie}`);
                
                if (db.tiendasActivas) db.tiendasActivas[jid] = false;
                await guardarDB();
                return responder(`${pre}\n║ ⛔ *TIENDA DESACTIVADA*\n║ El módulo fue apagado en ese grupo.\n${pie}`);
            }

            if (comando === "activarpin" && isCreator) {
                const num = args[0]; const jid = db.mapaGrupos?.[num]; if (!jid) return;
                db.gruposOTP[jid] = true; await guardarDB();
                return responder(`${pre}\n║ ✅ *OTP DESBLOQUEADO*\n║ Grupo ${num} tiene acceso a PIN.\n${pie}`);
            }

            if (comando === "desactivarpin" && isCreator) {
                const num = args[0]; const jid = db.mapaGrupos?.[num]; if (!jid) return;
                db.gruposOTP[jid] = false; await guardarDB();
                return responder(`${pre}\n║ ⛔ *OTP BLOQUEADO*\n║ Permiso revocado al grupo ${num}.\n${pie}`);
            }

            // ==========================================
            // 🏪 SISTEMA DE TIENDA PRO
            // ==========================================
            const comandosTienda = ["tienda", "catalogo", "misaldo", "saldo", "perfil", "comprar", "registrar", "deluser", "recargar", "dar", "quitar", "crearprod", "delprod", "addstock", "vaciarstock", "guiatienda", "iniciarcatalogo"];
            
            if (comandosTienda.includes(comando)) {
                if (!esGrupo) return responder(`${pre}\n║ ⚠️ La tienda opera dentro de grupos.\n${pie}`);
                if (!db.tiendasActivas?.[chat] && !isCreator) {
                    return responder(`╔══════════════════════════╗\n║ ⛔ *TIENDA INACTIVA*\n╠══════════════════════════╣\n║ Este grupo no tiene activo\n║ el módulo de Tienda Virtual.\n║ Contacta al Creador.\n╚══════════════════════════╝`);
                }
                asegurarTiendaGrupo(chat);
                const tGrupo = db.tiendasData[chat];

                if (comando === "guiatienda") {
                    if (!esAdmin) return;
                    return responder(`╔══════════════════════════╗\n║ 🏪 *CONTROL DE TIENDA PRO*\n╠══════════════════════════╣\n║ ⚡ *CARGAR CATÁLOGO OFICIAL*\n║ └ *.iniciarcatalogo*\n║\n║ 📦 *METER STOCK*\n║ ├ Con PIN (Netflix/Max): .addstock netflix c:p 5\n║ └ Sin PIN (Disney, Vix): .addstock disney c:p 5\n╚══════════════════════════╝`);
                }

                if (comando === "iniciarcatalogo") {
                    if (!esAdmin) return;
                    for (const cod in CATALOGO_BASE) {
                        const existente = tGrupo.productos[cod]?.cuentas || [];
                        tGrupo.productos[cod] = {
                            nombre: CATALOGO_BASE[cod].nombre,
                            precio: CATALOGO_BASE[cod].precio,
                            dias: CATALOGO_BASE[cod].dias,
                            garantia: CATALOGO_BASE[cod].garantia,
                            tipo: CATALOGO_BASE[cod].tipo,
                            cuentas: existente
                        };
                    }
                    await guardarDB();
                    return responder(`╔══════════════════════════╗\n║ 🚀 *CATÁLOGO OFICIAL LISTO*\n╠══════════════════════════╣\n║ ✅ Servicios cargados con éxito.\n║ Usa *.tienda* para revisarlo.\n╚══════════════════════════╝`);
                }

                if (comando === "registrar") {
                    if (!esAdmin) return responder(`${pre}\n║ ⛔ Solo Administradores.\n${pie}`);
                    let target = m.message.extendedTextMessage?.contextInfo?.participant || m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (!target) return responder(`${pre}\n║ ⚠️ Etiqueta al cliente.\n║ Ej: .registrar @user Juan\n${pie}`);
                    
                    const nombre = args.filter(a => !a.startsWith("@")).join(" ") || "Cliente VIP";
                    if (!tGrupo.usuarios[target]) {
                        tGrupo.usuarios[target] = { nombre: nombre, saldo: 0 };
                    } else {
                        tGrupo.usuarios[target].nombre = nombre;
                    }
                    await guardarDB();
                    return responder(`╔══════════════════════════╗\n║ ✅ *CLIENTE REGISTRADO*\n╠══════════════════════════╣\n║ 👤 Usuario: @${target.split("@")[0]}\n║ 🏷️ Nombre: ${nombre}\n║ 💰 Saldo: $${tGrupo.usuarios[target].saldo} MXN\n╚══════════════════════════╝`, [target]);
                }

                if (comando === "deluser") {
                    if (!esAdmin) return responder(`${pre}\n║ ⛔ Solo Administradores.\n${pie}`);
                    let target = m.message.extendedTextMessage?.contextInfo?.participant || m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (!target || !tGrupo.usuarios[target]) return responder(`${pre}\n║ ⚠️ Usuario no encontrado.\n${pie}`);
                    delete tGrupo.usuarios[target];
                    await guardarDB();
                    return responder(`${pre}\n║ 🗑️ Cliente eliminado de la tienda.\n${pie}`);
                }

                if (comando === "recargar" || comando === "dar" || comando === "quitar") {
                    if (!esAdmin) return responder(`${pre}\n║ ⛔ Solo el Admin autoriza saldo.\n${pie}`);
                    let target = m.message.extendedTextMessage?.contextInfo?.participant || m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (!target) return responder(`${pre}\n║ ⚠️ Etiqueta o responde al cliente.\n${pie}`);
                    
                    if (!tGrupo.usuarios[target]) return responder(`${pre}\n║ ⚠️ Regístralo primero con .registrar\n${pie}`);
                    const monto = parseFloat(args.find(a => !a.startsWith("@") && !isNaN(parseFloat(a))));
                    if (!monto || monto <= 0) return responder(`${pre}\n║ ⚠️ Ingresa un monto válido.\n${pie}`);

                    if (comando === "quitar") tGrupo.usuarios[target].saldo = Math.max(0, tGrupo.usuarios[target].saldo - monto);
                    else tGrupo.usuarios[target].saldo += monto;
                    await guardarDB();
                    return responder(`╔══════════════════════════╗\n║ 💳 *BILLETERA ACTUALIZADA*\n╠══════════════════════════╣\n║ 👤 Cliente: *${tGrupo.usuarios[target].nombre}*\n║ 💰 Nuevo Saldo: *$${tGrupo.usuarios[target].saldo} MXN*\n╚══════════════════════════╝`, [target]);
                }

                if (comando === "crearprod") {
                    if (!esAdmin) return responder(`${pre}\n║ ⛔ Solo Administradores.\n${pie}`);
                    const cod = args.shift()?.toLowerCase();
                    const precio = parseFloat(args.shift());
                    let dias = 30;
                    if (args[0] && !isNaN(parseInt(args[0]))) dias = parseInt(args.shift());
                    const nombre = args.join(" ");
                    if (!cod || isNaN(precio) || !nombre) return responder(`${pre}\n║ ⚠️ Uso: .crearprod [cod] [$] [días] [Nombre]\n${pie}`);
                    
                    let tipo = "cuenta";
                    if (nombre.toLowerCase().includes("canva") || nombre.toLowerCase().includes("invitacion")) tipo = "invitacion";
                    if (nombre.toLowerCase().includes("datos") || nombre.toLowerCase().includes("youtube")) tipo = "datos";

                    tGrupo.productos[cod] = { nombre, precio, dias, garantia: dias, tipo, cuentas: tGrupo.productos[cod]?.cuentas || [] };
                    await guardarDB();
                    return responder(`${pre}\n║ ✅ Producto *${cod}* guardado.\n${pie}`);
                }

                if (comando === "addstock") {
                    if (!esAdmin) return responder(`${pre}\n║ ⛔ Solo Administradores.\n${pie}`);
                    const cod = args.shift()?.toLowerCase();
                    if (!cod || !tGrupo.productos[cod]) return responder(`${pre}\n║ ⚠️ Código no existe. Usa .iniciarcatalogo\n${pie}`);

                    let numPerfiles = 1;
                    if (args.length > 1 && /^\d+$/.test(args[args.length - 1])) {
                        numPerfiles = parseInt(args.pop());
                    }
                    const datosCuenta = args.join(" ");
                    if (!datosCuenta) return responder(`${pre}\n║ ⚠️ Uso: .addstock [cod] [correo:pass] [perfiles]\n${pie}`);

                    if (!tGrupo.productos[cod].cuentas) tGrupo.productos[cod].cuentas = [];
                    const usaPins = cod.includes("net") || cod.includes("max");

                    if (numPerfiles > 1) {
                        for (let i = 1; i <= numPerfiles; i++) {
                            const pinAsignado = MAPA_PINS[i] || `${i}00${i}`;
                            const infoPerfil = usaPins ? `👤 *Perfil:* P${i} | 🔢 *PIN:* ${pinAsignado}` : `👤 *Perfil:* P${i}`;
                            tGrupo.productos[cod].cuentas.push(`${datosCuenta}\n║ ${infoPerfil}`);
                        }
                    } else {
                        const infoUnica = usaPins ? `👤 *Perfil:* P1 | 🔢 *PIN:* ${MAPA_PINS[1]}` : `👤 *Entrega:* Cuenta completa`;
                        tGrupo.productos[cod].cuentas.push(`${datosCuenta}\n║ ${infoUnica}`);
                    }

                    await guardarDB();
                    try { await sock.sendMessage(chat, { delete: m.key }); } catch (e) {}
                    return await sock.sendMessage(chat, { text: `╔══════════════════════════╗\n║ 🔐 *STOCK CARGADO*\n╠══════════════════════════╣\n║ 📺 ${tGrupo.productos[cod].nombre}\n║ 📦 Disponibles: *${tGrupo.productos[cod].cuentas.length}*\n╚══════════════════════════╝` });
                }

                if (comando === "vaciarstock") {
                    if (!esAdmin) return responder(`${pre}\n║ ⛔ Solo Administradores.\n${pie}`);
                    const cod = args[0]?.toLowerCase();
                    if (!cod || !tGrupo.productos[cod]) return responder(`${pre}\n║ ⚠️ Producto no encontrado.\n${pie}`);
                    tGrupo.productos[cod].cuentas = [];
                    await guardarDB();
                    return responder(`${pre}\n║ 🔴 Stock de *${tGrupo.productos[cod].nombre}* vaciado.\n${pie}`);
                }

                if (comando === "delprod") {
                    if (!esAdmin) return responder(`${pre}\n║ ⛔ Solo Administradores.\n${pie}`);
                    const cod = args[0]?.toLowerCase();
                    if (!cod || !tGrupo.productos[cod]) return responder(`${pre}\n║ ⚠️ Producto no encontrado.\n${pie}`);
                    delete tGrupo.productos[cod];
                    await guardarDB();
                    return responder(`${pre}\n║ 🗑️ Producto eliminado.\n${pie}`);
                }

                if (comando === "tienda" || comando === "catalogo") {
                    const prods = Object.keys(tGrupo.productos);
                    if (prods.length === 0) return responder(`${pre}\n║ 🏪 Catálogo vacío. Usa .iniciarcatalogo\n${pie}`);
                    let txt = `╔══════════════════════════╗\n║ 🚀 *MASTER-STREAMING*\n║ 📍 *${groupMetadata.subject}*\n╠══════════════════════════╣\n`;
                    for (const cod of prods) {
                        const p = tGrupo.productos[cod];
                        const cant = p.cuentas?.length || 0;
                        let estado = p.tipo === "invitacion" ? `📩 *Por Invitación*` : (p.tipo === "datos" ? `🔑 *A tus datos*` : (cant > 0 ? `🟢 *Stock: ${cant}*` : `🔴 *Agotado*`));
                        txt += `║ ${p.nombre} — *$${p.precio}*\n║  ├ ${estado}\n║  └ 🛒 *.comprar ${cod}*\n║\n`;
                    }
                    txt += `╚══════════════════════════╝`;
                    return responder(txt);
                }

                if (comando === "misaldo" || comando === "saldo" || comando === "perfil") {
                    const u = tGrupo.usuarios[senderId];
                    if (!u) return responder(`${pre}\n║ ⚠️ No estás registrado en la tienda.\n${pie}`);
                    return responder(`╔══════════════════════════╗\n║ 💳 *MI BILLETERA*\n╠══════════════════════════╣\n║ 👤 Cliente: *${u.nombre}*\n║ 💰 Saldo: *$${u.saldo} MXN*\n╚══════════════════════════╝`);
                }

                if (comando === "comprar") {
                    const u = tGrupo.usuarios[senderId];
                    if (!u) return responder(`${pre}\n║ ⛔ No estás registrado para comprar.\n${pie}`);
                    const cod = args.shift()?.toLowerCase();
                    const datosExtra = args.join(" ");
                    if (!cod) return responder(`${pre}\n║ ⚠️ Uso: .comprar [codigo]\n${pie}`);

                    const p = tGrupo.productos[cod];
                    if (!p) return responder(`${pre}\n║ ❌ Producto no encontrado.\n${pie}`);
                    if (u.saldo < p.precio) return responder(`${pre}\n║ ❌ Saldo insuficiente ($${u.saldo} MXN).\n${pie}`);

                    const diasVigencia = p.dias || 30;
                    const diasGarantia = p.garantia || diasVigencia;
                    const fInicioStr = new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' });
                    const fFinStr = new Date(Date.now() + (diasVigencia * 24 * 60 * 60 * 1000)).toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' });

                    if (p.tipo === "datos") {
                        if (!datosExtra.includes("@") || !datosExtra.includes(":")) {
                            return responder(`╔══════════════════════════╗\n║ 🔑 *DATOS REQUERIDOS*\n╠══════════════════════════╣\n║ Escribe tu correo y contraseña:\n║ *.comprar ${cod} correo@gmail.com:Clave*\n╚══════════════════════════╝`);
                        }
                        try { await sock.sendMessage(chat, { delete: m.key }); } catch (e) {}
                        u.saldo -= p.precio;
                        await guardarDB();
                        if (db.creador) {
                            try { await sock.sendMessage(db.creador, { text: `🔴 *PEDIDO DATOS:* ${p.nombre} | Cliente: ${u.nombre} | Datos: ${datosExtra}` }); } catch(e) {}
                        }
                        return await sock.sendMessage(chat, { text: `✅ Pedido de *${p.nombre}* recibido. Tus datos fueron enviados al Admin en privado. Saldo restante: $${u.saldo} MXN` });
                    }

                    if (p.tipo === "invitacion") {
                        if (!datosExtra.includes("@")) return responder(`${pre}\n║ ⚠️ Escribe tu correo para la invitación.\n${pie}`);
                        u.saldo -= p.precio;
                        await guardarDB();
                        if (db.creador) {
                            try { await sock.sendMessage(db.creador, { text: `🔔 *INVITACIÓN CANVA:* ${p.nombre} | Correo: ${datosExtra}` }); } catch(e) {}
                        }
                        return responder(`✅ Solicitud de *${p.nombre}* pagada. Se enviará a: ${datosExtra}. Saldo: $${u.saldo} MXN`);
                    }

                    const cant = p.cuentas?.length || 0;
                    if (cant === 0) return responder(`${pre}\n║ 🔴 Producto agotado (Sobre pedido).\n${pie}`);

                    u.saldo -= p.precio;
                    const cuentaEntregada = p.cuentas.shift();
                    await guardarDB();

                    const ficha = `╔══════════════════════════╗\n║ 🎉 *FICHA DE ENTREGA*\n╠══════════════════════════╣\n║ 📺 ${p.nombre}\n║ 👤 ${u.nombre}\n╠══════════════════════════╣\n║ 🔐 *ACCESO:*\n║ ${cuentaEntregada}\n╠══════════════════════════╣\n║ 🛑 Vence: ${fFinStr}\n║ 🛡️ Garantía: ${diasGarantia} días\n╚══════════════════════════╝`;

                    try { await sock.sendMessage(senderId, { text: ficha }); } 
                    catch (err) {
                        u.saldo += p.precio;
                        p.cuentas.unshift(cuentaEntregada);
                        await guardarDB();
                        return responder(`${pre}\n║ ⚠️ Mándame un "Hola" por privado primero para entregarte tu cuenta.\n${pie}`);
                    }

                    return responder(`✅ *¡Compra exitosa!* Ficha de *${p.nombre}* enviada a tu chat privado. Saldo restante: $${u.saldo} MXN`, [senderId]);
                }
            }

            // ==========================================
            // COMANDOS DE RESPUESTAS RÁPIDAS (AISLADOS POR GRUPO)
            // ==========================================
            if (comando === "activar") {
                if (!esGrupo || !esAdmin) return;
                if (!db.gruposComandos) db.gruposComandos = {};
                if (!db.gruposComandos[chat]) db.gruposComandos[chat] = {};
                await guardarDB();
                return responder(`${pre}\n║ ✅ Base de comandos para este grupo activada y vinculada a la nube.\n${pie}`);
            }

            if (comando === "set" && esAdmin) {
                const nCmd = args.shift()?.toLowerCase();
                const contenido = args.join(" ");
                if (!nCmd || !contenido) return responder(`${pre}\n║ ⚠️ Uso: .set [nombre] [texto]\n${pie}`);

                if (esGrupo) {
                    if (!db.gruposComandos) db.gruposComandos = {};
                    if (!db.gruposComandos[chat]) db.gruposComandos[chat] = {};
                    db.gruposComandos[chat][nCmd] = contenido;
                } else {
                    db.comandos[nCmd] = contenido;
                }
                await guardarDB();
                return responder(`${pre}\n║ ✅ Comando .${nCmd} guardado en el cajón de este grupo en la nube.\n${pie}`);
            }

            if (comando === "del" && esAdmin) {
                const nCmd = args[0]?.toLowerCase();
                if (esGrupo && db.gruposComandos?.[chat]) {
                    delete db.gruposComandos[chat][nCmd];
                } else {
                    delete db.comandos[nCmd];
                }
                await guardarDB();
                return responder(`${pre}\n║ 🗑️ Comando eliminado.\n${pie}`);
            }

            // LECTOR AISLADO DE COMANDOS .SET POR GRUPO
            let respCmd = null;
            if (esGrupo && db.gruposComandos?.[chat] && db.gruposComandos[chat][comando]) {
                respCmd = db.gruposComandos[chat][comando];
            } else if (db.comandos[comando]) {
                respCmd = db.comandos[comando];
            }

            if (respCmd) {
                if (respCmd.includes("╔═════")) return responder(respCmd);
                return responder(`╔══════════════════════════╗\n║ 💡 *INFORMACIÓN*\n╠══════════════════════════╣\n║ ${respCmd}\n╚══════════════════════════╝`);
            }

            // ==========================================
            // GESTIÓN DE OPERADORES PIN Y OTROS MÓDULOS
            // ==========================================
            if (comando === "addpin" && isCreator) {
                if (!esGrupo) return;
                let target = m.message.extendedTextMessage?.contextInfo?.participant || m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (!target) return responder(`${pre}\n║ ⚠️ Etiqueta al operador.\n${pie}`);
                if (!db.pinUsers) db.pinUsers = {};
                if (!db.pinUsers[chat]) db.pinUsers[chat] = [];
                if (!db.pinUsers[chat].includes(target)) db.pinUsers[chat].push(target);
                await guardarDB();
                return responder(`🔑 Operador @${target.split("@")[0]} autorizado para extraer PIN.`, [target]);
            }

            if (comando === "delpin" && isCreator) {
                if (!esGrupo) return;
                let target = m.message.extendedTextMessage?.contextInfo?.participant || m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (db.pinUsers?.[chat]) {
                    db.pinUsers[chat] = db.pinUsers[chat].filter(id => id !== target);
                    await guardarDB();
                }
                return responder(`🗑️ Operador revocado.`);
            }

            if (comando === "pin" || comando === "extraer") {
                if (!esGrupo) return;
                const autorizado = isCreator || (db.pinUsers?.[chat] && db.pinUsers[chat].includes(senderId));
                if (!autorizado) return responder(`⛔ Solo el Creador y Operadores autorizados pueden usar .pin`);
                if (!db.gruposOTP[chat] && !isCreator) return responder(`⛔ Grupo sin plan OTP.`);

                const plat = args[0]?.trim().toLowerCase();
                const corr = args[1]?.trim().toLowerCase();
                const sub = args[2] ? args[2].trim().toLowerCase() : "4dig";
                if (!plat || !corr?.includes("@")) return responder(`⚠️ Uso: .pin [plat] [correo]`);

                await responder(`⏳ Extrayendo en vivo...`);
                try {
                    const res = await fetch(`${APPS_SCRIPT_URL}?accion=extraer&plataforma=${encodeURIComponent(plat)}&correo=${encodeURIComponent(corr)}&subtipo=${encodeURIComponent(sub)}`);
                    const data = await res.json();
                    if (data?.ok) {
                        return responder(`✅ *CÓDIGO RECIBIDO*\n📺 Servicio: ${data.type || plat.toUpperCase()}\n🔑 OTP: *${data.code}*${data.link ? `\n🔗 Hogar: ${data.link}` : ""}`, [], { quoted: m });
                    } else {
                        return responder(`❌ ${data.error || "Código no hallado."}`);
                    }
                } catch (e) { return responder(`⚠️ Error de conexión con el script.`); }
            }

            // ==========================================
            // MÓDULO DE MODERACIÓN INTELIGENTE
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
                    const msg = `╔══════════════════════════╗\n║ ⏳ *ORDEN RECIBIDA*\n╠══════════════════════════╣\n║ 👤 Admin: @${senderId.split("@")[0]}\n║ 📍 Grupo: ${groupMetadata.subject}\n║ ⏳ Se ${esCerrar ? "cerrará" : "abrirá"} en: ${timeStr}\n║ 🕒 Hora: ${tFormat} (MX)\n╚══════════════════════════╝`;
                    await sock.sendMessage(chat, { text: msg, mentions: [senderId] }, { quoted: m });
                    setTimeout(async () => {
                        try {
                            await sock.groupSettingUpdate(chat, accionConfig);
                            await sock.sendMessage(chat, { text: `╔══════════════════════════╗\n║ 🛡 *SISTEMA DE SEGURIDAD*\n╠══════════════════════════╣\n║ 🔐 ESTADO: ${esCerrar ? "RESTRINGIDO 🔴" : "PÚBLICO 🟢"}\n╚══════════════════════════╝\n_Tiempo finalizado._` });
                        } catch (e) {}
                    }, delayMs);
                    return;
                }

                try {
                    await sock.groupSettingUpdate(chat, accionConfig);
                    await sock.sendMessage(chat, { text: `╔══════════════════════════╗\n║ 🛡 *SISTEMA DE SEGURIDAD*\n╠══════════════════════════╣\n║ 🔐 ESTADO: ${esCerrar ? "RESTRINGIDO 🔴" : "PÚBLICO 🟢"}\n╚══════════════════════════╝` });
                } catch (error) { return responder(`${pre}\n║ ❌ Necesitas hacerme Admin.\n${pie}`); }
                return;
            }

            // COMANDO .N (ANUNCIO 100% INVISIBLE)
            if (comando === "n") {
                if (!esGrupo || !esAdmin) return;
                let txtMsg = args.join(" ");
                let isQuoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!txtMsg && isQuoted) { txtMsg = isQuoted.conversation || isQuoted.extendedTextMessage?.text || isQuoted.imageMessage?.caption || isQuoted.videoMessage?.caption || ""; }
                if (!txtMsg && !isQuoted && !m.message.imageMessage && !m.message.videoMessage) return responder(`${pre}\n║ ⚠ Escribe un mensaje.\n${pie}`);
                
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
                let target = m.message.extendedTextMessage?.contextInfo?.participant || (m.message.extendedTextMessage?.contextInfo?.mentionedJid ? m.message.extendedTextMessage.contextInfo.mentionedJid[0] : null);
                if (!target) return;
                if (target === db.creador) return responder(`${pre}\n║ ⚠️ *BLINDAJE MAESTRO*\n║ Prohibido expulsar al Creador.\n${pie}`);
                try {
                    await sock.groupParticipantsUpdate(chat, [target], "remove");
                    return responder(`${pre}\n║ 👢 Usuario eliminado.\n${pie}`);
                } catch (e) {}
            }

            if (comando === "link") {
                if (!esGrupo || !esAdmin) return;
                try {
                    const code = await sock.groupInviteCode(chat);
                    return responder(`${pre}\n║ 🔗 *ENLACE DEL GRUPO*\n║ https://chat.whatsapp.com/${code}\n${pie}`);
                } catch (e) {}
            }

            if (comando === "tagall") {
                if (!esGrupo || !esAdmin) return;
                let msgTag = `╔══════════════════════════╗\n║ 📢 *LLAMADO GENERAL*\n╠══════════════════════════╣\n`;
                const menciones = groupMetadata.participants.map(p => { msgTag += `║ • @${p.id.split("@")[0]}\n`; return p.id; });
                msgTag += `╚══════════════════════════╝`;
                await sock.sendMessage(chat, { text: msgTag, mentions: menciones });
                return;
            }

            // ==========================================
            // MÓDULO DE ENTRETENIMIENTO Y JUEGOS
            // ==========================================
            if (comando === "carrera") {
                const msg = await sock.sendMessage(chat, { text: `${pre}\n║ 🏁 Preparando pista...\n${pie}` }, { quoted: m });
                const frames = [
                    `${pre}\n║ 🏁 *CARRERA EN CURSO*\n╠══════════════════════════╣\n║ 🚗💨          🏎️💨\n║\n║ _¡Arrancan!_\n${pie}`,
                    `${pre}\n║ 🏁 *CARRERA EN CURSO*\n╠══════════════════════════╣\n║    🚗💨      🏎️💨\n║\n║ _¡Curva peligrosa!_\n${pie}`,
                    `${pre}\n║ 🏁 *CARRERA EN CURSO*\n╠══════════════════════════╣\n║       🚗💨  🏎️💨\n║\n║ _¡Están parejos!_\n${pie}`,
                    `${pre}\n║ 🏁 *FINAL DE FOTOGRAFÍA*\n╠══════════════════════════╣\n║             🚗💨🏎️💨\n║\n║ 🏆 ¡GANA EL AUTO ROJO! 🏆\n${pie}`
                ];
                for (let i = 0; i < frames.length; i++) {
                    await new Promise(r => setTimeout(r, 1200));
                    await sock.sendMessage(chat, { edit: msg.key, text: frames[i] });
                }
                return;
            }

            if (comando === "bomba") {
                const msg = await sock.sendMessage(chat, { text: `${pre}\n║ 💣 *BOMBA ACTIVADA*\n╠══════════════════════════╣\n║ Destrucción en: ⏳ 3...\n${pie}` }, { quoted: m });
                await new Promise(r => setTimeout(r, 1200));
                await sock.sendMessage(chat, { edit: msg.key, text: `${pre}\n║ 💣 *BOMBA ACTIVADA*\n╠══════════════════════════╣\n║ Destrucción en: ⏳ 2...\n${pie}` });
                await new Promise(r => setTimeout(r, 1200));
                await sock.sendMessage(chat, { edit: msg.key, text: `${pre}\n║ 💣 *BOMBA ACTIVADA*\n╠══════════════════════════╣\n║ Destrucción en: ⏳ 1...\n${pie}` });
                await new Promise(r => setTimeout(r, 1200));
                await sock.sendMessage(chat, { edit: msg.key, text: `💥💥💥 *¡KABOOM!* 💥💥💥\n\n_El chat ha quedado en ruinas._` });
                return;
            }

            if (comando === "casino" || comando === "slots") {
                const msg = await sock.sendMessage(chat, { text: `${pre}\n║ 🎰 Girando rodillos...\n║ [ 🌀 | 🌀 | 🌀 ]\n${pie}` }, { quoted: m });
                const emojis = ["🍒", "🔔", "💎", "🍋", "🍉"];
                setTimeout(async () => {
                    const r1 = emojis[Math.floor(Math.random() * emojis.length)];
                    const r2 = emojis[Math.floor(Math.random() * emojis.length)];
                    const r3 = emojis[Math.floor(Math.random() * emojis.length)];
                    const win = (r1 === r2 && r2 === r3) ? "¡PREMIO MAYOR! 💰💰" : "Sigue intentando... 📉";
                    await sock.sendMessage(chat, { edit: msg.key, text: `${pre}\n║ 🎰 *RESULTADO*\n╠══════════════════════════╣\n║ [ ${r1} | ${r2} | ${r3} ]\n║\n║ ${win}\n${pie}` });
                }, 1500);
                return;
            }

            if (comando === "dado") {
                const msg = await sock.sendMessage(chat, { text: `${pre}\n║ 🎲 Agitando el dado... 🌪️\n${pie}` }, { quoted: m });
                setTimeout(async () => {
                    const cara = Math.floor(Math.random() * 6) + 1;
                    await sock.sendMessage(chat, { edit: msg.key, text: `${pre}\n║ 🎲 El dado cayó en: *${cara}* ✅\n${pie}` });
                }, 1000);
                return;
            }

            if (comando === "ruleta") {
                if (!esGrupo) return;
                if (esAdmin) return responder(`${pre}\n║ 🛡️ Los Admins no juegan.\n${pie}`);
                const msg = await sock.sendMessage(chat, { text: `${pre}\n║ 🔫 Girando el tambor... ⚙\n${pie}` }, { quoted: m });
                setTimeout(async () => {
                    if (Math.floor(Math.random() * 6) + 1 === 1) {
                        await sock.sendMessage(chat, { edit: msg.key, text: `${pre}\n║ 🔫 ¡PUM! 💥 Perdiste.\n${pie}` });
                        try { await sock.groupParticipantsUpdate(chat, [m.key.participant], "remove"); } catch(e) {}
                    } else {
                        await sock.sendMessage(chat, { edit: msg.key, text: `${pre}\n║ 🔫 Click... Te salvaste. 😅\n${pie}` });
                    }
                }, 2000);
                return;
            }

            if (comando === "suerte") {
                return responder(`${pre}\n║ 🍀 Tienes un *${Math.floor(Math.random() * 101)}%* de suerte.\n${pie}`);
            }

            if (comando === "doxeo" || comando === "doxxear") {
                let target = m.message.extendedTextMessage?.contextInfo?.participant || (m.message.extendedTextMessage?.contextInfo?.mentionedJid ? m.message.extendedTextMessage.contextInfo.mentionedJid[0] : null);
                let tag = target ? `@${target.split("@")[0]}` : "este usuario";
                
                const isps = ["Telmex (Debe 2 meses)", "Totalplay (Amenaza cancelar)", "Megacable (Robando WiFi)", "Izzi (Con cortes)", "Starlink (Es prestado)"];
                const locs = ["Ecatepec, Edomex", "San Pedro Garza García", "Tepito, CDMX", "Zapopan, Jalisco", "Culiacán, Sinaloa"];
                const devices = ["Alcatel con pantalla rota", "iPhone 15 Pro Max (En abonos)", "Samsung Galaxy J7", "Xiaomi (A punto de explotar)"];
                const secrets = ["Buscó: 'cómo volver con mi ex'", "Debe $500 en la tienda", "Escucha a Bad Bunny a escondidas", "Tiene fotos vergonzosas"];
                
                const ip = `${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;
                const call = await sock.sendMessage(chat, { text: `${pre}\n║ ☠️ Rastreando IP de ${tag}...\n${pie}`, mentions: target ? [target] : [] });
                
                setTimeout(async () => {
                    const ispInfo = isps[Math.floor(Math.random() * isps.length)];
                    const locInfo = locs[Math.floor(Math.random() * locs.length)];
                    const devInfo = devices[Math.floor(Math.random() * devices.length)];
                    const secInfo = secrets[Math.floor(Math.random() * secrets.length)];
                    
                    await sock.sendMessage(chat, { edit: call.key, text: `╔══════════════════════════╗\n║ ☠️ *DOXEO COMPLETADO*\n╠══════════════════════════╣\n║ 👤 Objetivo: ${tag}\n║ 📡 IP: ${ip}\n║ 📍 Ubicación: ${locInfo}\n║ 🌐 WiFi: ${ispInfo}\n║ 📱 Dispositivo: ${devInfo}\n║ 💳 Tarjeta: 4152 **** **** ${Math.floor(Math.random()*9000)+1000}\n║\n║ 🕵️‍♂️ *Secreto expuesto:*\n║ › ${secInfo}\n╚══════════════════════════╝`, mentions: target ? [target] : [] });
                }, 3000);
                return;
            }

            if (comando === "calentura" || comando === "pajero" || comando === "lesbiometro") {
                let target = m.message.extendedTextMessage?.contextInfo?.participant || (m.message.extendedTextMessage?.contextInfo?.mentionedJid ? m.message.extendedTextMessage.contextInfo.mentionedJid[0] : null);
                let tag = target ? `@${target.split("@")[0]}` : "este usuario";
                const nivel = Math.floor(Math.random() * 101);
                let diag = nivel > 80 ? "🔥 ¡Báñate con agua fría!" : nivel > 40 ? "😏 Andas en el punto exacto." : "🧊 Eres un témpano de hielo.";
                return await sock.sendMessage(chat, { text: `╔══════════════════════════╗\n║ 🌡️ *TEST DE ${comando.toUpperCase()}*\n╠══════════════════════════╣\n║ 👤 Analizando a: ${tag}\n║ 📊 Nivel: ${nivel}%\n║ 🩺 Diagnóstico: ${diag}\n╚══════════════════════════╝`, mentions: target ? [target] : [] });
            }

            if (comando === "ship" || comando === "parejas") {
                if (!esGrupo) return;
                const miembros = groupMetadata.participants.map(p => p.id);
                const miembrosReales = miembros.filter(id => id !== sock.user.id.split(":")[0]+"@s.whatsapp.net");
                const user1 = miembrosReales[Math.floor(Math.random() * miembrosReales.length)];
                const user2 = miembrosReales[Math.floor(Math.random() * miembrosReales.length)];
                return await sock.sendMessage(chat, { text: `╔══════════════════════════╗\n║ 💘 *NUEVA PAREJA*\n╠══════════════════════════╣\n║ 👉 @${user1.split("@")[0]}\n║ 👉 @${user2.split("@")[0]}\n║\n║ ¡Ya bésense y dejen el drama! 👩‍❤️‍💋‍👨\n╚══════════════════════════╝`, mentions: [user1, user2] });
            }

            if (comando === "piropo") {
                const piropos = ["Si la belleza fuera delito, yo te daría cadena perpetua. 😘", "¿Crees en el amor a primera vista o vuelvo a pasar? 😉", "No soy donante de órganos, pero te doy mi corazón. ❤️", "Quien fuera sol para darte todo el día. ☀️", "Me gustas más que dormir hasta tarde. 😴", "Estás como para invitarte a comer taquitos. 🌮"];
                const random = piropos[Math.floor(Math.random() * piropos.length)];
                return responder(`${pre}\n║ 😏 ${random}\n${pie}`);
            }

            // ==========================================
            // MENÚ PRINCIPAL Y SUBMENÚS
            // ==========================================
            if (comando === "menu" || comando === "help") {
                const fch = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
                let menuTxt = `╔══════════════════════════╗
║  🤖 *MASTER SYSTEM*
║  📋 *Menú Principal*
║  📅 ${fch}
╠══════════════════════════╣
║ 🏪 TIENDA AUTOMÁTICA
║  ├ .tienda - Ver stock vivo
║  ├ .misaldo - Mi billetera
║  ├ .comprar [código]
║  └ .guiatienda (Solo Admin)
║
║ 🛒 RESPUESTAS RÁPIDAS
║  └ .set [cmd] [texto]
║
║ 🔐 SISTEMA OTP
║  └ .pin [plat] [correo]
║
║ ⚙️ MODERACIÓN
║  ├ .cerrar [5m] / .abrir [1h]
║  ├ .n [texto] - Anuncio
║  ├ .kick [@user]
║  ├ .link / .tagall
║  └ .activar - Iniciar DB
║
║ 🎮 ENTRETENIMIENTO
║  └ .juegos - Ver catálogo
╚══════════════════════════╝`;
                
                if (isCreator) {
                    menuTxt += `\n\n╔══════════════════════════╗\n║ 👑 *ZONA CREADOR*\n╠══════════════════════════╣\n║  ├ .listagrupos\n║  ├ .licencia [días] [num]\n║  ├ .activartienda [num]\n║  ├ .desactivartienda [num]\n║  ├ .activarpin [num]\n║  ├ .addpin / .delpin [@user]\n║  └ .nube (Status Nube)\n╚══════════════════════════╝`;
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
║ 🎮 *MINIJUEGOS*
╠══════════════════════════╣
║  ├ .carrera / .bomba
║  ├ .casino / .dado
║  ├ .ruleta / .suerte
║  ├ .doxeo / .parejas
║  ├ .calentura / .pajero
║  └ .piropo
╚══════════════════════════╝`);
            }

        } catch (error) { console.error("Error:", error); }
    });
}

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

iniciarBot();
