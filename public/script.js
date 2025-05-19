// Éléments du DOM
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startBtn = document.getElementById('startBtn');
const hangupBtn = document.getElementById('hangupBtn');
const screenShareBtn = document.getElementById('screenShareBtn');
const fileBtn = document.getElementById('fileBtn');
const fileInput = document.getElementById('fileInput');
const roomIdInput = document.getElementById('roomId');
const joinBtn = document.getElementById('joinBtn');
const createBtn = document.getElementById('createBtn');
const messagesDiv = document.getElementById('messages');
const statusDiv = document.getElementById('status');


document.getElementById('toggleVideoBtn').addEventListener('click', toggleVideo);
document.getElementById('toggleAudioBtn').addEventListener('click', toggleAudio);
document
  .getElementById("sendMessageBtn")
  .addEventListener("click", sendMessage);
// Permettre d'envoyer avec la touche Entrée
document.getElementById('messageInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
      sendMessage();
  }
});

// Variables globales
let localStream;
let remoteStream;
let peerConnection;
let dataChannel;
let roomId;
let socket;
let isScreenSharing = false;
let isVideoEnabled = true;
let isAudioEnabled = true;
let localVideoTrack;
let localAudioTrack;

// Configuration STUN/TURN (utilisez vos propres serveurs en production)
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        // Ajoutez des serveurs TURN si nécessaire
        // { urls: 'turn:your.turn.server', username: 'user', credential: 'pass' }
    ]
};

// Initialiser la connexion Socket.io
function initSocket() {
    socket = io();

    socket.on('joined', (room, id) => {
        statusDiv.textContent = `Dans la salle: ${room} (${id})`;
    });

    socket.on('room-full', (room) => {
        statusDiv.textContent = `La salle ${room} est pleine.`;
    });

    socket.on('ready', (room) => {
        statusDiv.textContent = `Connecté à la salle ${room}. Prêt pour l'appel.`;
        startBtn.disabled = false;
    });

    socket.on('webrtc-message', async (message) => {
        if (message.type === 'offer') {
            await handleOffer(message);
        } else if (message.type === 'answer') {
            await handleAnswer(message);
        } else if (message.type === 'candidate') {
            await handleCandidate(message);
        }
    });
}

// Initialiser la connexion WebRTC
async function initWebRTC() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    localVideo.srcObject = localStream;
    startBtn.disabled = false;

    // Stocker les tracks pour pouvoir les activer/désactiver
    localVideoTrack = localStream.getVideoTracks()[0];
    localAudioTrack = localStream.getAudioTracks()[0];
  } catch (err) {
    console.error("Erreur lors de l'accès aux médias:", err);
    statusDiv.textContent =
      "Erreur: Impossible d'accéder à la caméra/microphone";
  }
}

// Créer une offre WebRTC
async function createOffer() {
    peerConnection = new RTCPeerConnection(configuration);
    
    // Ajouter les tracks locales
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });
    
    // Configurer le data channel
    dataChannel = peerConnection.createDataChannel('fileTransfer');
    setupDataChannel();
    
    // Écouter les candidats ICE
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('webrtc-message', {
                type: 'candidate',
                candidate: event.candidate,
                roomId: roomId
            });
        }
    };
    
    // Écouter les tracks distantes
    peerConnection.ontrack = (event) => {
        remoteStream = event.streams[0];
        remoteVideo.srcObject = remoteStream;
    };
    
    // Créer l'offre
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    socket.emit('webrtc-message', {
        type: 'offer',
        sdp: offer.sdp,
        roomId: roomId
    });
    
    statusDiv.textContent = 'Offre envoyée, en attente de réponse...';
}

// Gérer une offre reçue
async function handleOffer(message) {
    if (!peerConnection) {
        peerConnection = new RTCPeerConnection(configuration);
        
        // Ajouter les tracks locales
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        // Configurer le data channel
        peerConnection.ondatachannel = (event) => {
            dataChannel = event.channel;
            setupDataChannel();
        };
        
        // Écouter les candidats ICE
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('webrtc-message', {
                    type: 'candidate',
                    candidate: event.candidate,
                    roomId: roomId
                });
            }
        };
        
        // Écouter les tracks distantes
        peerConnection.ontrack = (event) => {
            remoteStream = event.streams[0];
            remoteVideo.srcObject = remoteStream;
        };
    }
    
    await peerConnection.setRemoteDescription(new RTCSessionDescription({
        type: 'offer',
        sdp: message.sdp
    }));
    
    // Créer la réponse
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    socket.emit('webrtc-message', {
        type: 'answer',
        sdp: answer.sdp,
        roomId: roomId
    });
    
    statusDiv.textContent = 'Réponse envoyée, connexion en cours...';
}

// Gérer une réponse reçue
async function handleAnswer(message) {
    if (!peerConnection) return;
    
    await peerConnection.setRemoteDescription(new RTCSessionDescription({
        type: 'answer',
        sdp: message.sdp
    }));
    
    statusDiv.textContent = 'Connexion établie!';
    hangupBtn.disabled = false;
}

// Gérer un candidat ICE reçu
async function handleCandidate(message) {
    if (!peerConnection) return;
    
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
    } catch (err) {
        console.error('Erreur lors de l\'ajout du candidat ICE:', err);
    }
}

// Configurer le data channel
function setupDataChannel() {
  dataChannel.onopen = () => {
    addMessage("Data channel ouvert - prêt pour la communication");
  };

  dataChannel.onclose = () => {
    addMessage("Data channel fermé");
  };

  dataChannel.onmessage = (event) => {
    if (event.data instanceof Blob) {
      handleReceivedFile(event.data);
    } else {
      addMessage(`Partenaire: ${event.data}`);
    }
  };
}

// Gérer un fichier reçu
function handleReceivedFile(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fichier_recu';
    a.textContent = 'Télécharger le fichier reçu';
    a.style.display = 'block';
    a.style.margin = '10px 0';
    
    addMessage('Fichier reçu! ');
    messagesDiv.appendChild(a);
}

// Ajouter un message au chat
function addMessage(message) {
    const p = document.createElement('p');
    p.textContent = message;
    messagesDiv.appendChild(p);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Terminer l'appel
function hangUp() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject.getTracks().forEach(track => track.stop());
        remoteVideo.srcObject = null;
    }
    
    if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
    }
    
    startBtn.disabled = false;
    hangupBtn.disabled = true;
    screenShareBtn.textContent = 'Partager l\'écran';
    isScreenSharing = false;
    
    statusDiv.textContent = 'Appel terminé';
}

// Partager l'écran
async function toggleScreenShare() {
    if (!peerConnection) return;
    
    try {
        if (!isScreenSharing) {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = screenStream.getVideoTracks()[0];
            
            // Remplacer la piste vidéo
            const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
            await sender.replaceTrack(screenTrack);
            
            // Arrêter l'ancien flux quand le nouveau est terminé
            screenTrack.onended = () => toggleScreenShare();
            
            isScreenSharing = true;
            screenShareBtn.textContent = 'Arrêter le partage';
            statusDiv.textContent = 'Partage d\'écran activé';
        } else {
            const userStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const userTrack = userStream.getVideoTracks()[0];
            
            // Remplacer la piste vidéo
            const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
            await sender.replaceTrack(userTrack);
            
            isScreenSharing = false;
            screenShareBtn.textContent = 'Partager l\'écran';
            statusDiv.textContent = 'Partage d\'écran désactivé';
        }
    } catch (err) {
        console.error('Erreur lors du partage d\'écran:', err);
        statusDiv.textContent = 'Erreur lors du partage d\'écran';
    }
}

// Envoyer un fichier
function sendFile() {
    fileInput.click();
}

// Gérer la sélection de fichier
fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (dataChannel && dataChannel.readyState === 'open') {
        addMessage(`Envoi du fichier: ${file.name} (${formatFileSize(file.size)})`);
        dataChannel.send(file);
    } else {
        addMessage('Erreur: Data channel non disponible');
    }
};

// Formater la taille du fichier
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Basculer la vidéo
function toggleVideo() {
  if (localVideoTrack) {
      isVideoEnabled = !isVideoEnabled;
      localVideoTrack.enabled = isVideoEnabled;
      
      const videoBtn = document.getElementById('toggleVideoBtn');
      videoBtn.textContent = isVideoEnabled ? 'Désactiver caméra' : 'Activer caméra';
      videoBtn.classList.toggle('active', !isVideoEnabled);
      
      statusDiv.textContent = isVideoEnabled ? 'Caméra activée' : 'Caméra désactivée';
  }
}

// Basculer l'audio
function toggleAudio() {
  if (localAudioTrack) {
      isAudioEnabled = !isAudioEnabled;
      localAudioTrack.enabled = isAudioEnabled;
      
      const audioBtn = document.getElementById('toggleAudioBtn');
      audioBtn.textContent = isAudioEnabled ? 'Désactiver micro' : 'Activer micro';
      audioBtn.classList.toggle('active', !isAudioEnabled);
      
      statusDiv.textContent = isAudioEnabled ? 'Micro activé' : 'Micro désactivé';
  }
}

function sendMessage() {
  const messageInput = document.getElementById("messageInput");
  const message = messageInput.value.trim();

  if (message && dataChannel && dataChannel.readyState === "open") {
    // Afficher le message localement
    addMessage(`Moi: ${message}`);

    // Envoyer via le DataChannel
    dataChannel.send(message);

    // Vider le champ
    messageInput.value = "";
  } else if (!dataChannel || dataChannel.readyState !== "open") {
    addMessage("Erreur: Connexion non disponible pour envoyer des messages");
  }
}

// Événements
startBtn.addEventListener('click', createOffer);
hangupBtn.addEventListener('click', hangUp);
screenShareBtn.addEventListener('click', toggleScreenShare);
fileBtn.addEventListener('click', sendFile);

joinBtn.addEventListener('click', () => {
    roomId = roomIdInput.value.trim();
    if (!roomId) return;
    
    socket.emit('join', roomId);
    startBtn.disabled = true;
});

createBtn.addEventListener('click', () => {
    roomId = uuid.v4().substring(0, 8);
    roomIdInput.value = roomId;
    socket.emit('join', roomId);
    startBtn.disabled = true;
});

// Initialisation
initSocket();
initWebRTC();
