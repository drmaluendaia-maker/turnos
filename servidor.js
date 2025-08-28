// 1. Configuración del servidor (con 'pg' para la base de datos)
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const os = require('os');
const { Pool } = require('pg'); // Importamos el conector de PostgreSQL

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = 3000;

// --- Conexión a la Base de Datos ---
// Render nos da la URL de conexión a través de las variables de entorno
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Función para crear las tablas si no existen
const crearTablas = async () => {
    const crearTablaMedicos = `
        CREATE TABLE IF NOT EXISTS medicos (
            id VARCHAR(50) PRIMARY KEY,
            nombre VARCHAR(100) NOT NULL,
            especialidad VARCHAR(100) NOT NULL,
            consultorio VARCHAR(50) NOT NULL,
            atendiendo_id VARCHAR(50)
        );
    `;
    const crearTablaPacientes = `
        CREATE TABLE IF NOT EXISTS pacientes (
            id VARCHAR(50) PRIMARY KEY,
            nombre VARCHAR(100) NOT NULL,
            medico_id VARCHAR(50) NOT NULL,
            hora_llegada BIGINT NOT NULL,
            status VARCHAR(50) NOT NULL
        );
    `;
    try {
        await pool.query(crearTablaMedicos);
        await pool.query(crearTablaPacientes);
        console.log('Tablas aseguradas en la base de datos.');
    } catch (err) {
        console.error('Error al crear las tablas:', err);
    }
};

app.use(express.static(__dirname));
app.get('/', (req, res) => res.redirect('/registro.html'));

// 2. Lógica de la aplicación
let llamadoActual = null;

io.on('connection', async (socket) => {
    console.log('Un cliente se ha conectado.');

    // --- Enviar estado inicial desde la BD ---
    const emitirUpdates = async (targetSocket = io) => {
        try {
            const medicosRes = await pool.query('SELECT * FROM medicos ORDER BY nombre');
            const pacientesRes = await pool.query("SELECT * FROM pacientes WHERE status != 'atendido' ORDER BY hora_llegada");
            const medicosConPacientes = await Promise.all(medicosRes.rows.map(async (medico) => {
                if (medico.atendiendo_id) {
                    const pacienteActualRes = await pool.query('SELECT id, nombre FROM pacientes WHERE id = $1', [medico.atendiendo_id]);
                    medico.atendiendo = pacienteActualRes.rows[0] || null;
                }
                return medico;
            }));
            targetSocket.emit('update_medicos', medicosConPacientes);
            targetSocket.emit('update_pacientes', pacientesRes.rows);
            if (targetSocket === socket) {
                socket.emit('update_llamado', llamadoActual);
            }
        } catch (err) {
            console.error('Error al emitir actualizaciones:', err);
        }
    };
    
    // Enviar estado inicial solo al cliente que se acaba de conectar
    emitirUpdates(socket);

    // --- Eventos de la Base de Datos ---
    socket.on('agregar_medico', async (medico) => {
        const nuevoMedico = { id: `med-${Date.now()}`, ...medico };
        await pool.query('INSERT INTO medicos (id, nombre, especialidad, consultorio) VALUES ($1, $2, $3, $4)', [nuevoMedico.id, nuevoMedico.nombre, nuevoMedico.especialidad, nuevoMedico.consultorio]);
        emitirUpdates();
    });

    socket.on('eliminar_medico', async (medicoId) => {
        await pool.query('DELETE FROM medicos WHERE id = $1', [medicoId]);
        await pool.query("DELETE FROM pacientes WHERE medico_id = $1 AND status = 'en_espera'", [medicoId]);
        emitirUpdates();
    });

    socket.on('registrar_paciente', async (paciente) => {
        const nuevoPaciente = { id: `pac-${Date.now()}`, ...paciente, status: 'en_espera' };
        await pool.query('INSERT INTO pacientes (id, nombre, medico_id, hora_llegada, status) VALUES ($1, $2, $3, $4, $5)', [nuevoPaciente.id, nuevoPaciente.nombre, nuevoPaciente.medicoId, nuevoPaciente.horaLlegada, nuevoPaciente.status]);
        emitirUpdates();
    });

    socket.on('llamar_paciente', async ({ medicoId, pacienteId }) => {
        await pool.query("UPDATE pacientes SET status = 'atendido' WHERE id = (SELECT atendiendo_id FROM medicos WHERE id = $1)", [medicoId]);
        await pool.query("UPDATE pacientes SET status = 'atendiendo' WHERE id = $1", [pacienteId]);
        await pool.query('UPDATE medicos SET atendiendo_id = $1 WHERE id = $2', [pacienteId, medicoId]);
        
        const medicoRes = await pool.query('SELECT consultorio, especialidad FROM medicos WHERE id = $1', [medicoId]);
        const pacienteRes = await pool.query('SELECT nombre FROM pacientes WHERE id = $1', [pacienteId]);

        if (medicoRes.rows.length > 0 && pacienteRes.rows.length > 0) {
            llamadoActual = { nombre: pacienteRes.rows[0].nombre, consultorio: medicoRes.rows[0].consultorio, especialidad: medicoRes.rows[0].especialidad };
            io.emit('update_llamado', llamadoActual);
            setTimeout(() => { llamadoActual = null; io.emit('update_llamado', null); }, 15000);
        }
        emitirUpdates();
    });
    
    socket.on('finalizar_atencion', async (medicoId) => {
        await pool.query("UPDATE pacientes SET status = 'atendido' WHERE id = (SELECT atendiendo_id FROM medicos WHERE id = $1)", [medicoId]);
        await pool.query('UPDATE medicos SET atendiendo_id = NULL WHERE id = $1', [medicoId]);
        emitirUpdates();
    });
    
    // --- Evento para recibir el ping ---
    socket.on('ping', () => {
        // No es necesario hacer nada, solo recibirlo.
    });

    socket.on('disconnect', () => console.log('Un cliente se ha desconectado.'));
});

// 3. Iniciar el servidor
server.listen(PORT, async () => {
    await crearTablas(); // Nos aseguramos de que las tablas existan
    const ip = getLocalIpAddress();
    console.log('----------------------------------------------------');
    console.log('      Servidor de Sala de Espera INICIADO (con DB)  ');
    console.log('----------------------------------------------------');
});

function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]) {
            if (net.family === 'IPv4' && !net.internal) return net.address;
        }
    }
    return 'localhost';
}
