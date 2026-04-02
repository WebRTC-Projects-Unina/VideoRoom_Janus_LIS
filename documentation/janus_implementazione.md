# Architettura Janus WebRTC Server

Questo documento illustra nel dettaglio come **Janus Gateway** è stato integrato all'interno della nostra applicazione React per gestire l'infrastruttura P2P e le stanze virtuali (VideoRoom).

## Il Ruolo di Janus: Selective Forwarding Unit (SFU)
A differenza di un classico approccio WebRTC Mesh (dove ogni client è connesso direttamente a tutti gli altri con n*(n-1)/2 connessioni), il nostro progetto implementa una topologia "a stella" sfruttando Janus come **Selective Forwarding Unit (SFU)**.

In un'architettura SFU:
- Ogni client (browser) instaura **una singola connessione WebRTC** in upload (Publisher) per inviare i propri flussi (Webcam, Audio, DataChannel Testuale) al Server Janus.
- Il Server Janus agisce da "router multimediale": riceve i flussi da un utente e li inoltra (forwarding) a tutti gli altri membri della stanza.
- Ogni client instaura poi una connessione in download (Subscriber) per ogni altro partecipante attivo da cui desidera ricevere il flusso.

**Vantaggi per il nostro ecosistema LIS:**
1. **Risparmio Banda in Upload:** L'utente invia la propria telecamera una sola volta a prescindere da quanti siano gli spettatori.
2. **Scalabilità:** Permette lezioni/conferenze con un numero elevato di partecipanti senza saturare le connessioni casalinghe.

## Il Plugin "VideoRoom"
Janus è un software modulare composto da plugin. Per questo progetto è stato scelto il **plugin `janus.plugin.videoroom`**, in quanto espone nativamente le API necessarie per simulare una "Classe Virtuale".

### 1. Inizializzazione e Connessione (Signaling tramite WebSocket)
Nel file `VideoRoom.js`, l'inizializzazione parte istanziando la libreria ufficiale `janus.js`.
La comunicazione di controllo (Signaling) tra l'app React e il Server Janus (situato su `wss://janus.conf.meetecho.com/ws`) avviene tramite **Secure WebSockets**.

Attraverso i WebSocket scambiamo i pacchetti `SDP` (Session Description Protocol) per negoziare i codec audio/video e raccogliamo i candidati `ICE` per oltrepassare eventuali Firewall/NAT.

### 2. Il Flusso "Publisher" (Chi trasmette)
Al completamento dell'init Janus, il client si attacca al plugin e invia una richiesta `join` configurandosi come `publisher`.
Subito dopo chiama `createOffer` usando la sintassi moderna dell'API **`tracks`**:

```javascript
sfuPluginRef.current.createOffer({
  tracks: [
    { type: 'audio', capture: true, recv: false },
    { type: 'video', capture: true, recv: false },
    { type: 'data' }  // Apre il DataChannel per la Chat P2P
  ],
  success: function(jsepOffer) {
    sfuPluginRef.current.send({ message: { request: "configure" }, jsep: jsepOffer });
  }
});
```

> **Nota:** La vecchia sintassi `media: { audioSend: true, videoSend: true, data: true }` è ancora compatibile ma **deprecata** dalla documentazione Meetecho. La sintassi con `tracks` è quella raccomandata per le versioni correnti di Janus.

Se la telecamera non è disponibile (es. il browser la blocca), il codice usa un fallback **"Solo Dati"** specificando solo `{ type: 'data' }` nell'array `tracks`: la Chat P2P funziona comunque anche senza stream video/audio.

### 3. I Flussi "Subscriber" (L'Ascolto)
Quando Janus notifica la stanza che un nuovo utente è attivo (evento `publishers`), l'app React chiama `newRemoteFeed()`.

Questa funzione lancia una nuova istanza del plugin `videoroom` come **subscriber**, usando la sintassi moderna con l'array `streams`:

```javascript
const subscribe = {
  request: "join",
  ptype: "subscriber",
  streams: [{ feed: publisherId }]  // Sintassi moderna (non più il campo "feed" diretto)
};
remoteFeed.send({ message: subscribe });
```

Janus risponde con un JSEP SDP offer. Il client risponde con un `createAnswer`, specificando solo `{ type: 'data' }`: i track audio e video remoti vengono **accettati automaticamente** in modalità recv-only dalla libreria senza bisogno di dichiararli esplicitamente.

### 4. Gestione dei Track Remoti con `onremotetrack`
La `onremotetrack` (API moderna, sostituisce la deprecated `onremotestream`) viene invocata una volta per ogni singolo **MediaStreamTrack** (prima l'audio, poi il video) ricevuto.
Nella callback, aggiungiamo ogni track progressivamente ad un `MediaStream` React per alimentare l'elemento `<video>` nella griglia dei partecipanti:

```javascript
onremotetrack: function(track, mid, added) {
  if (added) {
    setRemoteStreams(prev => {
      const existingStream = prev[id] || new MediaStream();
      existingStream.addTrack(track);
      return { ...prev, [id]: existingStream };
    });
  }
}
```

### 5. Il Sistema di Chat P2P Ibrido (DataChannel)
Al completamento del giro di negoziazione ICE-SDP, Janus innesca l'evento `ondataopen` comunicando che il DataChannel è pronto.

Quando l'utente digita nella ChatBox o l'IA (WASM) consolida una parola LIS, il testo viene serializzato in JSON e consegnato a Janus tramite `sfuPluginRef.current.data(...)`. Il server SFU distribuisce il messaggio a tutti i Subscriber della stanza in latenza quasi nulla, senza mai passare per API REST o Database esterni.

### 6. Gestione delle Uscite (evento `leaving`)
Quando un publisher lascia la stanza, Janus genera un evento `msg["leaving"]` contenente il suo ID. Il client reagisce **eliminando immediatamente lo stream di quell'utente** dalla griglia React:

```javascript
if (msg["leaving"]) {
  setRemoteStreams(prev => {
    const copy = { ...prev };
    delete copy[msg["leaving"]];
    return copy;
  });
}
```
