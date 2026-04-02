import React, { useState, useEffect, useRef } from 'react';
import LocalVideo from './LocalVideo';
import RemoteVideoGrid from './RemoteVideoGrid';
import ChatBox from './ChatBox';
import adapter from 'webrtc-adapter';
import Janus from 'janus-gateway';

const vocalisLogo = process.env.PUBLIC_URL + '/assets/vocalis-logo.png';

window.adapter = adapter;


// L'URL pubblico di test offerto dai creatori di Janus (Meetecho)
// Usiamo WSS (Secure WebSocket) per garantire l'audio/video criptato
const server = "wss://janus.conf.meetecho.com/ws";


export default function VideoRoom({ roomID, username, onLeave }) {
  const [currentSign, setCurrentSign] = useState("");
  const [messages, setMessages] = useState([]);
  const [janusInitialized, setJanusInitialized] = useState(false);
  const [dataChannelOpen, setDataChannelOpen] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState({}); // Mappa ID -> MediaStream
  const [aiEnabled, setAiEnabled] = useState(false); // Flag globale per l'Intelligenza Artificiale

  const janusRef = useRef(null); // Riferimento all'istanza della sessione Janus
  const sfuPluginRef = useRef(null); // Riferimento al Plugin VideoRoom
  const myIdRef = useRef(null); // Riferimento all'ID dell'utente (assegnato da Janus)

  // Usiamo i valori passati dalla HomePage
  const myUsernameRef = useRef(username);
  const MY_ROOM = roomID;
  const OPAQUE_ID = "videoroomtest-" + Janus.randomString(12); // sessionID

  useEffect(() => {
    Janus.init({
      debug: false,
      callback: function () {
        if (!Janus.isWebrtcSupported()) {
          console.error("No WebRTC support... ");
          return;
        }

        // Crea la sessione col Gateway
        const janus = new Janus({
          server: server,
          success: function () {
            janusRef.current = janus;
            setJanusInitialized(true);

            // Attacchiamo il plugin VideoRoom
            janus.attach({
              plugin: "janus.plugin.videoroom",
              opaqueId: OPAQUE_ID,
              success: function (pluginHandle) {
                sfuPluginRef.current = pluginHandle;
                Janus.log("Plugin attached! (" + pluginHandle.getPlugin() + ", id=" + pluginHandle.getId() + ")");

                // Registrazione automatica nella Stanza (Join) come Publisher
                const register = {
                  request: "join",
                  room: MY_ROOM,
                  ptype: "publisher",
                  display: myUsernameRef.current
                };
                pluginHandle.send({ message: register });
              },
              error: function (error) {
                Janus.error("  -- Error attaching plugin...", error);
              },
              onmessage: function (msg, jsep) {
                Janus.debug(" ::: Got a message (publisher) :::", msg);
                const event = msg["videoroom"];

                if (event === "joined") {
                  myIdRef.current = msg["id"];
                  Janus.log("Successfully joined room " + msg["room"] + " with ID " + myIdRef.current);

                  // Pubblichiamo il nostro feed con la sintassi moderna 'tracks'
                  sfuPluginRef.current.createOffer({
                    tracks: [
                      { type: 'audio', capture: true, recv: false }, //capture è l'astrazione di Janus della getUserMedia()
                      { type: 'video', capture: true, recv: false },
                      { type: 'data' }
                    ],
                    success: function (jsepOffer) {
                      Janus.debug("Got publisher SDP!", jsepOffer);
                      const publish = { request: "configure", audio: true, video: true, data: true };
                      sfuPluginRef.current.send({ message: publish, jsep: jsepOffer });
                    },
                    error: function (error) {
                      Janus.error("WebRTC error acquiring camera:", error);
                      // FALLBACK: telecamera non disponibile → connessione Solo Dati
                      Janus.warn("Riprovo la connessione in modalit\u00e0 'Solo Chat' (Senza Webcam)...");
                      sfuPluginRef.current.createOffer({
                        tracks: [
                          { type: 'data' }
                        ],
                        success: function (fallbackJsep) {
                          Janus.debug("Got publisher SDP (Data ONLY)!", fallbackJsep);
                          const publish = { request: "configure", audio: false, video: false, data: true };
                          sfuPluginRef.current.send({ message: publish, jsep: fallbackJsep });
                        },
                        error: function (err) {
                          Janus.error("Fatal WebRTC error:", err);
                        }
                      });
                    }
                  });
                }

                // Se la stanza non esiste sul server Meetecho, creiamola noi al volo!
                if (msg["error_code"] === 426) {
                  Janus.log("La stanza " + MY_ROOM + " non esiste. La creo subito...");
                  sfuPluginRef.current.send({
                    message: {
                      request: "create",
                      room: MY_ROOM,
                      publishers: 6,
                      bitrate: 128000,
                      fir_freq: 1,
                      is_private: false
                    },
                    success: function (result) {
                      Janus.log("Stanza creata:", result);
                      if (result["videoroom"] === "created") {
                        const retryJoin = {
                          request: "join",
                          room: MY_ROOM,
                          ptype: "publisher",
                          display: myUsernameRef.current
                        };
                        sfuPluginRef.current.send({ message: retryJoin });
                      }
                    }
                  });
                }

                // Quando qualcun altro entra nella stanza!
                if (msg["publishers"]) {
                  const list = msg["publishers"];
                  Janus.debug("Got a list of available publishers/feeds:", list);
                  for (let f in list) {
                    const id = list[f]["id"];
                    const display = list[f]["display"];
                    const audio = list[f]["audio_codec"];
                    const video = list[f]["video_codec"];
                    Janus.debug("  >> [" + id + "] " + display + " (audio: " + audio + ", video: " + video + ")");
                    newRemoteFeed(id, display); // Ci iscriviamo al loro flusso!
                  }
                }

                if (msg["leaving"]) {
                  // Un utente è uscito: rimuoviamo il suo stream dalla griglia
                  const leaving = msg["leaving"];
                  Janus.log("Publisher left: " + leaving);
                  setRemoteStreams(prev => {
                    const copy = { ...prev };
                    delete copy[leaving];
                    return copy;
                  });
                }

                // Gestione risposta SDP dal server Janus
                if (jsep) {
                  sfuPluginRef.current.handleRemoteJsep({ jsep: jsep });
                }
              },
              webrtcState: function (on) {
                Janus.log("Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
              },
              iceState: function (state) {
                Janus.log("ICE state changed to " + state);
              },
              onlocalstream: function (stream) {
                Janus.debug(" ::: Got a local stream :::", stream);
              },
              ondataopen: function () {
                Janus.log("Il DataChannel P2P per la Chat e ai Segni è APERTO e FUNZIONANTE!");
                setDataChannelOpen(true);
              },
              ondata: function (data) {
                Janus.debug("Messaggio arrivato sul DataChannel stringificato: ", data);
                try {
                  const parsed = JSON.parse(data);
                  setMessages(prev => [...prev, { sender: parsed.user, text: parsed.message }]);
                } catch (e) {
                  Janus.warn("Payload DataChannel mal formato", data);
                }
              },
              oncleanup: function () {
                Janus.log(" ::: Got a cleanup notification: we are unpublished now :::");
              }
            });
          },
          error: function (cause) {
            console.error("Errore di connessione a Janus:", cause);
          },
          destroyed: function () {
            console.log("Sessione Janus distrutta");
          }
        });
      }
    });

    return () => {
      if (janusRef.current) {
        setJanusInitialized(false);
        janusRef.current.destroy();
        janusRef.current = null;
      }
    };
  }, []); // [] significa che viene eseguito solo una volta al mount del componente, se fosse stato vuoto sarebbe stato eseguito ad ogni render

  // Creazione di una nuova connessione passiva per guardare/ascoltare un ALTRO utente
  const newRemoteFeed = (id, display) => {
    let remoteFeed = null;
    janusRef.current.attach({
      plugin: "janus.plugin.videoroom",
      opaqueId: OPAQUE_ID,
      success: function (pluginHandle) {
        remoteFeed = pluginHandle;
        Janus.log("Plugin attached! (" + remoteFeed.getPlugin() + ", id=" + remoteFeed.getId() + ")");

        // Chiediamo a Janus di iscriverci al feed di questo utente (sintassi moderna con 'streams')
        const subscribe = {
          request: "join",
          room: MY_ROOM,
          ptype: "subscriber",
          streams: [{ feed: id }],
          private_id: myIdRef.current
        };
        remoteFeed.send({ message: subscribe });
      },
      error: function (error) {
        Janus.error("  -- Error attaching plugin...", error);
      },
      onmessage: function (msg, jsep) {
        Janus.debug(" ::: Got a message (subscriber) :::", msg);

        // Rispondiamo all'offerta di Janus per ricevere A/V e Dati
        if (jsep) {
          Janus.debug("Handling SDP as well...", jsep);
          // Risposta Answer (vogliamo ricevere tutto, Dati inclusi!)
          remoteFeed.createAnswer({
            jsep: jsep,
            // Specifichiamo solo 'data': audio e video vengono accettati automaticamente in recv-only
            tracks: [
              { type: 'data' }
            ],
            success: function (jsepAnswer) {
              Janus.debug("Got SDP!", jsepAnswer);
              const body = { request: "start", room: MY_ROOM };
              remoteFeed.send({ message: body, jsep: jsepAnswer });
            },
            error: function (error) {
              Janus.error("WebRTC error:", error);
            }
          });
        }
      },
      onremotetrack: function (track, mid, added) {
        // Riceviamo ogni singolo track (audio o video) separatamente
        Janus.debug(" ::: Got a remote track :::", track, mid, added);
        if (added) {
          setRemoteStreams(prev => {
            // Aggiungiamo il track allo stream esistente, o ne creiamo uno nuovo
            const existingStream = prev[id] ? prev[id].stream : new MediaStream();
            existingStream.addTrack(track);
            return { ...prev, [id]: { stream: existingStream, display: display } };
          });
        }
      },
      ondata: function (data) {
        Janus.debug("Messaggio arrivato sul DataChannel stringificato SECONDO FEED: ", data);
        try {
          const parsed = JSON.parse(data);
          setMessages(prev => [...prev, { sender: parsed.user, text: parsed.message }]);
        } catch (e) {
          Janus.warn("Payload DataChannel mal formato", data);
        }
      },
      ondataopen: function () {
        Janus.log("DataChannel del subscriber aperto.");
      },
      oncleanup: function () {
        Janus.log(" ::: Got a cleanup notification (remote feed) :::");
        // Rimuoviamo il video quando l'utente si disconnette
        setRemoteStreams(prev => {
          const copy = { ...prev };
          delete copy[id];
          return copy;
        });
      }
    });
  };

  const handleSignDetected = (sign) => {
    setCurrentSign(sign);
  };

  // Invia il testo in chat locale e sulla rete WebRTC tramite DataChannel
  const dispatchMessageToNetwork = (text) => {
    setMessages(prev => [...prev, { sender: "Io (LIS/Testo)", text: text }]);

    if (sfuPluginRef.current && dataChannelOpen) {
      const payload = { user: myUsernameRef.current, message: text };
      sfuPluginRef.current.data({
        text: JSON.stringify(payload),
        error: (err) => console.error("Errore invio DataChannel:", err),
        success: () => console.log("Messaggio inviato in P2P!")
      });
    } else {
      console.warn("DataChannel non pronto. Messaggio solo in locale.", text);
    }
  };

  const styles = {
    container: { 
      minHeight: '100vh', 
      backgroundColor: '#A33DBD', 
      padding: '20px', 
      fontFamily: 'system-ui, -apple-system, sans-serif' 
    },
    header: { 
      display: 'flex', 
      justifyContent: 'space-between', 
      alignItems: 'center', 
      backgroundColor: 'white', 
      padding: '15px 30px', 
      borderRadius: '12px', 
      marginBottom: '20px', 
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)' 
    },
    logo: { 
      height: '50px', 
      width: 'auto' 
    },
    roomInfo: { 
      textAlign: 'center' 
    },
    title: { 
      margin: 0, 
      color: '#A33DBD', 
      fontSize: '1.5rem' 
    },
    subtitle: { 
      margin: 0, 
      color: '#5f6368', 
      fontSize: '0.9rem' 
    },
    controls: { 
      display: 'flex', 
      gap: '12px' 
    },
    buttonAi: (enabled) => ({
      padding: '10px 20px',
      borderRadius: '8px',
      fontWeight: 'bold',
      cursor: 'pointer',
      backgroundColor: enabled ? '#3BB39A' : '#f44336',
      color: 'white',
      border: 'none',
      transition: 'all 0.2s',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    }),
    buttonLeave: {
      padding: '10px 20px',
      borderRadius: '8px',
      fontWeight: 'bold',
      cursor: 'pointer',
      backgroundColor: '#f0f2f5',
      color: '#70757a',
      border: 'none',
      transition: 'all 0.2s'
    },
    mainGrid: { 
      display: 'grid', 
      gridTemplateColumns: '1fr 2fr', 
      gap: '20px',
      marginBottom: '20px'
    },
    section: {
      backgroundColor: 'white',
      borderRadius: '12px',
      padding: '20px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
    }
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <img src={vocalisLogo} alt="Vocalis Logo" style={styles.logo} />
        
        <div style={styles.roomInfo}>
          <h1 style={styles.title}>Stanza: {MY_ROOM}</h1>
          <p style={styles.subtitle}>Utente: <strong>{username}</strong></p>
        </div>

        <div style={styles.controls}>
          <button 
            onClick={() => setAiEnabled(!aiEnabled)} 
            style={styles.buttonAi(aiEnabled)}
          >
            {aiEnabled ? "🧠 LIS: ON" : "📵 LIS: OFF"}
          </button>
          <button 
            onClick={onLeave} 
            style={styles.buttonLeave}
          >
            Esci
          </button>
        </div>
      </header>

      {!janusInitialized && (
        <div style={{...styles.section, textAlign: 'center', marginBottom: '20px', color: '#f39c12', fontWeight: 'bold'}}>
          Connessione al server pubblico Janus in corso...
        </div>
      )}

      <div style={styles.mainGrid}>
        <div style={styles.section}>
          <LocalVideo onSignDetected={handleSignDetected} aiEnabled={aiEnabled} />
        </div>
        <div style={styles.section}>
          <RemoteVideoGrid remoteStreams={remoteStreams} />
        </div>
      </div>

      <div style={styles.section}>
        <ChatBox
          currentSign={currentSign}
          messages={messages}
          onSendMessage={dispatchMessageToNetwork}
        />
      </div>
    </div>
  );
}