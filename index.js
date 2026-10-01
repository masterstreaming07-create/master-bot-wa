sock.ev.on("messages.upsert", async (chatUpdate) => {
        try {
            if (!chatUpdate.messages) return;
            const m = chatUpdate.messages[0];
            if (!m.message) return;

            // 1. Ignorar si el mensaje lo envió el propio bot (evita bucles)
            if (m.key.fromMe) return;

            // 2. Extraer texto limpio
            const texto = obtenerTextoMensaje(m);
            const chat = m.key.remoteJid;

            // 3. Ignorar cualquier mensaje que no empiece estrictamente con "."
            if (!texto || !texto.startsWith(".")) return;

            console.log(`[COMANDO RECIBIDO]: "${texto}" en ${chat}`);

            const args = texto.slice(1).trim().split(/ +/);
            const comando = args.shift().toLowerCase();
            const esGrupo = chat.endsWith("@g.us");

            // --- COMANDO .ping ---
            if (comando === "ping") {
                await sock.sendMessage(chat, { text: "🏓 ¡Pong! El bot está respondiendo en tiempo real." }, { quoted: m });
            }

            // --- COMANDO .menu ---
            else if (comando === "menu" || comando === "info") {
                const menu = `🤖 *MASTER BOT WA*\n\n` +
                             `📌 *.abrir* - Abre el grupo\n` +
                             `📌 *.cerrar* - Cierra el grupo\n` +
                             `📌 *.codigo [servicio]* - Consulta de códigos\n` +
                             `📌 *.ping* - Probar estado`;
                await sock.sendMessage(chat, { text: menu }, { quoted: m });
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
