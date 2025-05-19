const express = require('express');
const socketio = require('socket.io');
const uuid = require('uuid');
const app = express();
const PORT = process.env.PORT || 3000;

// Servir les fichiers statiques
app.use(express.static('public'));

// Démarrer le serveur
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Configurer Socket.io
const io = socketio(server);

// Gestion des connexions Socket.io
io.on('connection', (socket) => {
    console.log(`New connection: ${socket.id}`);

    // Rejoindre une room
    socket.on('join', (roomId) => {
        const roomClients = io.sockets.adapter.rooms.get(roomId) || new Set();
        const numClients = roomClients.size;

        if (numClients >= 2) {
            socket.emit('room-full', roomId);
            return;
        }

        socket.join(roomId);
        socket.emit('joined', roomId, socket.id);

        if (numClients === 1) {
            io.to(roomId).emit('ready', roomId);
        }
    });

    // Relayer les messages WebRTC
    socket.on('webrtc-message', (message) => {
        socket.broadcast.emit('webrtc-message', message);
    });

    // Déconnexion
    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
    });
});
