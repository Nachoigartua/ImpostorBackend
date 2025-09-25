import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { nanoid } from 'nanoid';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const jugadoresFutbol = [
    "Pavon",
    "Calleri",
    "Orion",
    "Valzig",
    "Tobi Zabala",
    "Pelé",
    "Diego Maradona",
    "Johan Cruyff",
    "Alfredo Di Stéfano",
    "Franz Beckenbauer",
    "Michel Platini",
    "George Best",
    "Bobby Charlton",
    "Eusébio",
    "Paolo Maldini",
    "Roberto Baggio",
    "Marco van Basten",
    "Ruud Gullit",
    "Lev Yashin",
    "Garrincha",
    "Gerd Müller",
    "Lothar Matthäus",
    "Ronald Koeman",
    "Zico",
    "Sócrates",
    "Romário",
    "Rivaldo",
    "Cafú",
    "Hristo Stoichkov",
    "Fernando Hierro",
    "Ronaldo Nazário",
    "Ronaldinho",
    "Zinedine Zidane",
    "Thierry Henry",
    "Patrick Vieira",
    "Juan Román Riquelme",
    "Martín Palermo",
    "Carlos Tévez",
    "Hugo Ibarra",
    "Ariel Ortega",
    "Marcelo Gallardo",
    "Enzo Francescoli",
    "Norberto Alonso",
    "Leonardo Ponzio",
    "Ricardo Bochini",
    "Daniel Montenegro",
    "Gabriel Milito",
    "Sergio Agüero",
    "Arsenio Erico",
    "Diego Milito",
    "El zeta (amigo emirta)",
    "Cristina Kirchner"
];


const salas = {};

io.on('connection', (socket) => {
  socket.on('configurarSala', ({ salaId, maxJugadores, impostores }) => {
    const sala = salas[salaId];
    if (!sala || sala.host !== socket.id) return;
    sala.maxJugadores = maxJugadores;
    sala.impostores = impostores;
    io.to(salaId).emit('actualizarLobby', {
      jugadores: sala.jugadores,
      host: sala.host
    });
  });
  socket.on('crearSala', ({ nombre, maxJugadores, impostores }) => {
    const salaId = nanoid(6);
    salas[salaId] = {
      host: socket.id,
      jugadores: [{ id: socket.id, nombre }],
      maxJugadores,
      impostores,
      estado: 'lobby',
      votos: [],
      expulsados: [],
      roles: {},
      resultado: null
    };
    socket.join(salaId);
    socket.emit('salaCreada', { salaId });
    io.to(salaId).emit('actualizarLobby', {
      jugadores: salas[salaId].jugadores,
      host: salas[salaId].host
    });
  });

  socket.on('unirseSala', ({ nombre, salaId }) => {
    const sala = salas[salaId];
    if (!sala || sala.jugadores.length >= sala.maxJugadores) {
      socket.emit('errorSala', 'Sala no existe o está llena');
      return;
    }
    sala.jugadores.push({ id: socket.id, nombre });
    socket.join(salaId);
    io.to(salaId).emit('actualizarLobby', {
      jugadores: sala.jugadores,
      host: sala.host
    });
  });

  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  socket.on('comenzarPartida', (salaId) => {
    const sala = salas[salaId];
    if (!sala || sala.host !== socket.id) return;
    sala.estado = 'jugando';
    // Asignar roles
    let ids = sala.jugadores.map(j => j.id);
    let impostores = [];
    while (impostores.length < sala.impostores) {
      let idx = Math.floor(Math.random() * ids.length);
      let id = ids[idx];
      if (!impostores.includes(id)) impostores.push(id);
    }
    let jugadorFutbol = jugadoresFutbol[Math.floor(Math.random() * jugadoresFutbol.length)];
    sala.roles = {};
    sala.jugadores.forEach(j => {
      if (impostores.includes(j.id)) {
        sala.roles[j.id] = 'IMPOSTOR';
      } else {
        sala.roles[j.id] = jugadorFutbol;
      }
    });
    
    // Crear orden aleatorio inicial
    sala.ordenJugadores = shuffleArray([...sala.jugadores]);
    
    io.to(salaId).emit('partidaIniciada', { jugadores: sala.ordenJugadores });
    // Enviar rol a cada jugador
    sala.jugadores.forEach(j => {
      io.to(j.id).emit('rolAsignado', { rol: sala.roles[j.id] });
    });
  });

  socket.on('iniciarVotacion', (salaId) => {
    const sala = salas[salaId];
    if (!sala || sala.estado !== 'jugando') return;
    sala.votos = [];
    io.to(salaId).emit('faseVotacion', sala.jugadores.filter(j => !sala.expulsados.includes(j.id)));
  });

  socket.on('votar', ({ salaId, voto }) => {
    const sala = salas[salaId];
    if (!sala) return;
    sala.votos.push({ id: socket.id, voto });
    if (sala.votos.length === sala.jugadores.filter(j => !sala.expulsados.includes(j.id)).length) {
      // Contar votos
      let conteo = {};
      sala.votos.forEach(v => {
        conteo[v.voto] = (conteo[v.voto] || 0) + 1;
      });
      let max = 0, expulsado = null;
      Object.entries(conteo).forEach(([k, v]) => {
        if (v > max && k !== 'skip') {
          max = v;
          expulsado = k;
        }
      });
      let empate = Object.values(conteo).filter(v => v === max).length > 1;
      if (conteo['skip'] && conteo['skip'] >= max) expulsado = null;
      if (expulsado && !empate) {
        sala.expulsados.push(expulsado);
        io.to(salaId).emit('jugadorExpulsado', expulsado);
      } else {
        io.to(salaId).emit('nadieExpulsado');
      }
      // Verificar fin de partida
      let vivos = sala.jugadores.filter(j => !sala.expulsados.includes(j.id));
      let impostoresVivos = vivos.filter(j => sala.roles[j.id] === 'impostor').length;
      let comunesVivos = vivos.length - impostoresVivos;
      if (impostoresVivos === 0) {
        sala.resultado = 'tripulantes';
        io.to(salaId).emit('finPartida', 'Ganaron los tripulantes');
      } else if (impostoresVivos >= comunesVivos) {
        sala.resultado = 'impostores';
        io.to(salaId).emit('finPartida', 'Ganaron los impostores');
      }
    }
  });

  socket.on('sortearJugadores', (salaId) => {
    const sala = salas[salaId];
    if (!sala || sala.host !== socket.id || sala.estado !== 'jugando') return;
    
    // Generar nuevo orden aleatorio
    sala.ordenJugadores = shuffleArray([...sala.jugadores]);
    io.to(salaId).emit('jugadoresOrdenados', { jugadores: sala.ordenJugadores });
  });

  socket.on('obtenerEstadoSala', (salaId) => {
    const sala = salas[salaId];
    if (sala) {
      if (sala.estado === 'jugando') {
        socket.emit('jugadoresOrdenados', { jugadores: sala.ordenJugadores || sala.jugadores });
        // También reenviamos el rol al jugador
        if (sala.roles[socket.id]) {
          socket.emit('rolAsignado', { rol: sala.roles[socket.id] });
        }
      }
      // Enviamos la información del host
      socket.emit('actualizarLobby', {
        jugadores: sala.jugadores,
        host: sala.host
      });
    }
  });

  socket.on('sortearJugadores', (salaId) => {
    const sala = salas[salaId];
    if (!sala || sala.host !== socket.id || sala.estado !== 'jugando') return;
    
    // Generar nuevo orden aleatorio
    sala.ordenJugadores = shuffleArray([...sala.jugadores]);
    
    // Emitir el nuevo orden a todos los jugadores de la sala
    io.to(salaId).emit('jugadoresOrdenados', { jugadores: sala.ordenJugadores });
  });

  socket.on('disconnect', () => {
    Object.entries(salas).forEach(([salaId, sala]) => {
      sala.jugadores = sala.jugadores.filter(j => j.id !== socket.id);
      if (sala.host === socket.id && sala.jugadores.length > 0) {
        sala.host = sala.jugadores[0].id;
      }
      io.to(salaId).emit('actualizarLobby', {
        jugadores: sala.jugadores,
        host: sala.host
      });
      if (sala.jugadores.length === 0) delete salas[salaId];
    });
  });
});

server.listen(3000, () => console.log('Servidor iniciado en puerto 3000'));
