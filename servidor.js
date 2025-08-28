// 1. Configuración del servidor
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = 3000;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.redirect('/registro.html');
});

// 2. Lógica de la aplicación
let medicos = [];
let pacientes = [];
let llamadoActual = null;

io.on('connection', (socket) => {
    console.log('Un cliente se ha conectado.');

    // Enviar estado inicial a todos los clientes
    socket.emit('update_medicos', medicos);
    socket.emit('update_pacientes', pacientes);
    socket.emit('update_llamado', llamadoActual);


    // --- Eventos de Médicos ---
    socket.on('agregar_medico', (medico) => {
        medicos.push({ id: `med-${Date.now()}`, ...medico, atendiendo: null });
        io.emit('update_medicos', medicos);
    });

    socket.on('eliminar_medico', (medicoId) => {
        medicos = medicos.filter(m => m.id !== medicoId);
        io.emit('update_medicos', medicos);
    });


    // --- Eventos de Pacientes ---
    socket.on('registrar_paciente', (paciente) => {
        pacientes.push({ id: `pac-${Date.now()}`, ...paciente, status: 'en_espera' });
        io.emit('update_pacientes', pacientes);
    });

    socket.on('llamar_paciente', ({ medicoId, pacienteId }) => {
        const medico = medicos.find(m => m.id === medicoId);
        const paciente = pacientes.find(p => p.id === pacienteId);

        if (medico && paciente) {
            // Liberar paciente anterior del médico
            if (medico.atendiendo) {
                const pacienteAnterior = pacientes.find(p => p.id === medico.atendiendo.id);
                if (pacienteAnterior) pacienteAnterior.status = 'atendido';
            }

            // Asignar nuevo paciente
            paciente.status = 'atendiendo';
            medico.atendiendo = paciente;
            
            llamadoActual = {
                nombre: paciente.nombre,
                consultorio: medico.consultorio,
                especialidad: medico.especialidad
            };

            io.emit('update_pacientes', pacientes);
            io.emit('update_medicos', medicos);
            io.emit('update_llamado', llamadoActual);

            setTimeout(() => {
                llamadoActual = null;
                io.emit('update_llamado', null);
            }, 15000); // El llamado dura 15 segundos
        }
    });
    
    socket.on('finalizar_atencion', (medicoId) => {
        const medico = medicos.find(m => m.id === medicoId);
        if(medico && medico.atendiendo) {
            const pacienteAtendido = pacientes.find(p => p.id === medico.atendiendo.id);
            if(pacienteAtendido) {
                pacienteAtendido.status = 'atendido';
            }
            medico.atendiendo = null;

            // Filtramos los pacientes para quitar a los ya atendidos
            pacientes = pacientes.filter(p => p.status !== 'atendido');

            io.emit('update_pacientes', pacientes);
            io.emit('update_medicos', medicos);
        }
    });


    socket.on('disconnect', () => {
        console.log('Un cliente se ha desconectado.');
    });
});


// 3. Iniciar el servidor
function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]) {
            if (net.family === 'IPv4' && !net.internal) return net.address;
        }
    }
    return 'localhost';
}

server.listen(PORT, () => {
    const ip = getLocalIpAddress();
    console.log('----------------------------------------------------');
    console.log('      Servidor de Sala de Espera INICIADO           ');
    console.log('----------------------------------------------------');
    console.log(`\n -> App de Registro: http://${ip}:${PORT}/registro.html`);
    console.log(` -> App del Médico:   http://${ip}:${PORT}/medico.html`);
    console.log(` -> Pantalla de TV:   http://${ip}:${PORT}/tv.html`);
});