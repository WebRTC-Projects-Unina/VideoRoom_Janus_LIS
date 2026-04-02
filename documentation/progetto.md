# Piattaforma LIS Connect: Documentazione Architetturale

Questo documento offre una panoramica architetturale e tecnica della piattaforma "LIS Connect", un sistema innovativo concepito per abbattere le barriere comunicative integrando il riconoscimento in tempo reale della Lingua dei Segni (LIS) all'interno di un ecosistema di videochiamata multi-utente.

L'obiettivo principale del progetto è fornire un ambiente virtuale accessibile e scalabile, simile a una classe o a una sala riunioni, in cui gli utenti possano comunicare fluidamente con gli altri partecipanti. Attraverso l'uso della webcam, l'intelligenza artificiale locale interpreta i gesti dell'utente e li traduce istantaneamente in messaggi di testo trasmessi nella chat comune, facilitando così un'interazione inclusiva che non richiede software esterni o intermediari umani.

Nelle sezioni seguenti, esploreremo nel dettaglio le tre anime tecnologiche che rendono possibile questo flusso end-to-end:
1. La struttura dell'interfaccia utente, sviluppata come Single Page Application in **React**.
2. L'infrastruttura di rete basata su **WebRTC** e orchestrata tramite **Janus SFU** per garantire scalabilità e minima latenza.
3. Il motore di intelligenza artificiale locale, alimentato da **TensorFlow.js**, isolato in **Web Worker** e accelerato tramite **WebAssembly (WASM)** per mantenere prestazioni fluide.

---

## 1. Struttura dell'Applicazione Front-End

L'applicazione è sviluppata come una Single Page Application (SPA) in React. La logica di routing e gestione dello stato globale della sessione è centralizzata in `App.js`.

### 1.1. `App.js`: Gestore di Stato e Navigazione
Funge da entry-point dinamico. Mantiene lo stato della connessione corrente (`sessionData`) che contiene il nome dell'utente e l'ID della stanza.
- **Se `sessionData` è vuoto:** renderizza il componente `HomePage`.
- **Se `sessionData` è popolato:** renderizza il componente `VideoRoom`, passandogli i dati di sessione come `props`.

### 1.2. `HomePage.js`: Gatekeeper e Gestione Stato Iniziale
Questo componente rappresenta il primo entry-point per l'utente (Landing Page). A differenza di un form tradizionale che ricarica la pagina, `HomePage.js` è un componente che implementa una form dentro la quale vengono inseriti i dati per la sessione (nome utente e ID stanza).

**Gestione dello Stato Locale:**
Il componente si appoggia ad hook `useState` per tracciare i dati in tempo reale, mantenendo due token fondamentali:
- **`username`:** L'identificativo verbale del client, che verrà poi allegato al feed remoto e iniettato nei payload della ChatBox P2P.
- **`room`:** L'identificativo numerico della stanza virtuale da interrogare nativamente sul Gateway Janus.

```javascript
export default function HomePage({ onJoin }) {
    const [username, setUsername] = useState('');
    const [room, setRoom] = useState('');
    // ...
```

**Validazione e Sollevamento dello Stato (State Lifting):**
Quando inviamo la richiesta tramite `<form onSubmit={handleSubmit}>`, l'invio triggera una funzione di controllo che ferma il ricaricamento del browser (`e.preventDefault()`). Subito dopo, viene fatta una validazione client-side per assicurarsi che i campi siano valorizzati.

Se i dati sono validi, l'ID della stanza viene tassativamente convertito in numero intero (un requisito stretto affinché le API del plugin VideoRoom di Janus accettino il comando) e veicolato verso l'alto (al padre `App.js`) sfruttando la prop / callback `onJoin`:

```javascript
    const handleSubmit = (e) => {
        e.preventDefault();
        if (username && room) {
            onJoin({ username, room: parseInt(room) }); // Il parsing a intero è essenziale per Janus
        } else {
            alert("Per favore, inserisci sia il nome che il numero della stanza.");
        }
    };
```
In questo modo alteriamo l'oggetto genitore `sessionData` in `App.js`. Come risultato React effettua il demount del componente `HomePage` sgomberando la vista, e carica al suo posto il componente `VideoRoom.js`, istanziandolo con queste precise chiavi appena raccolte.

### 1.3. `VideoRoom.js`: Il Cuore dell'Applicazione e l'Automa JSEP
Questo componente orchestra sia la UI della stanza che la complessa comunicazione di rete, agendo come client per il server WebRTC Janus.

**Comportamento dinamico tramite Props:**
`VideoRoom` riceve `username` e `roomID` nativamente da `HomePage`. I riferimenti WebRTC (`MY_ROOM`, `myUsernameRef.current`) vengono inizializzati con questi parametri, permettendo la creazione dinamica di aule virtuali separate.

**Struttura UI Interna:**
*   `<LocalVideo>`: Gestisce la webcam e l'elaborazione AI locale tramite WebWorker (con toggle per il traduttore LIS).
*   `<RemoteVideoGrid>`: Renderizza dinamicamente i `MediaStream` (audio/video) ricevuti dagli altri partecipanti.
*   `<ChatBox>`: Visualizza la chat multi-utente trasmessa in P2P tramite DataChannel e permette l'invio sia manuale che guidato dall'AI.

**Il Meccanismo JSEP (JavaScript Session Establishment Protocol):**
Il vero nucleo tecnico di `VideoRoom.js` risiede nel modo in cui gestisce il protocollo **JSEP**, un automa a stati finiti essenziale per stabilire connessioni WebRTC (scambi Offer/Answer) coordinandosi con il Gateway Janus tramite WebSockets.

Quando un utente entra, si attacca inizialmente come **Publisher** (chi trasmette stream):
Il client invia una richiesta `join` e avvia la fase di negoziazione creando un'offerta SDP (`createOffer`), in cui specifica i flussi multimediali (audio/video) e l'apertura esplicita del DataChannel per i testi:
```javascript
sfuPluginRef.current.createOffer({
  tracks: [
    { type: 'audio', capture: true, recv: false },
    { type: 'video', capture: true, recv: false },
    { type: 'data' } // Fondamentale per la Chat P2P e l'invio LIS
  ],
  success: function (jsepOffer) {
    // L'offerta SDP appena generata viene spedita via WebSocket a Janus
    const publish = { request: "configure", audio: true, video: true, data: true };
    sfuPluginRef.current.send({ message: publish, jsep: jsepOffer });
  }
});
```
Janus riceve questa offerta, alloca le porte ice, e risponde a sua volta con una **Answer** contenente un pacchetto JSEP remoto. Il componente React lo intercetta e completa l'handshake passandolo ad `handleRemoteJsep({ jsep: jsep })`. Come piano di riserva, se la fotocamera non fosse autorizzata dal browser, l'automa è programmato per cadere elegantemente in un "fallback Solo Dati", rigenerando un `createOffer` contenente unicamente `{ type: 'data' }`.

Parallelamente all'upload, l'applicazione gestisce dinamicamente i flussi in download come **Subscriber** (chi riceve):
Ogni volta che Janus notifica la presenza di un nuovo membro nella stanza (evento `msg["publishers"]`), `VideoRoom` invoca la funzione `newRemoteFeed()`. In questo giro negoziale le parti si invertono: è Janus a recapitarci un'**Offer** SDP per farci iscrivere al feed remoto. Il nostro client elabora questo JSEP in entrata rispondendo con una **Answer** SDP tramite `createAnswer`, accettando l'A/V passivamente e richiedendo l'aggancio dati:
```javascript
remoteFeed.createAnswer({
  jsep: jsep, // L'offerta SDP in ingresso inviata da Janus
  tracks: [ { type: 'data' } ], // Accetta audio/video automaticamente, chiede dati
  success: function (jsepAnswer) {
    const body = { request: "start", room: MY_ROOM };
    remoteFeed.send({ message: body, jsep: jsepAnswer }); // Invia l'Answer chiudendo il cerchio
  }
});
```
Attraverso questa negoziazione JSEP, `VideoRoom.js` mantiene lo stato effimero di molteplici *PeerConnection* WebRTC.

Inoltre `VideoRoom` espone un bottone "Esci" (`onLeave`) che non si limita a un cambio pagina, ma chiama `janusRef.current.destroy()`. Questo azzera forzatamente l'automa di stato, dealloca le PeerConnection distruggendo gli hook JSEP e pulendo la memoria per evitare colli di bottiglia nel browser, prima di riportare l'utente alla `HomePage`.

### 1.4. `LocalVideo.js`: Acquisizione Ottica ed Estrazione Feature (MediaPipe)
Questo componente rappresenta gli "occhi" dell'applicazione. Isola completamente tutta la logica legata all'acquisizione del flusso video locale (Webcam) e alla complessa pipeline di Computer Vision necessaria per trasformare i pixel crudi in *landmark* tridimensionali pronti per l'Inferenza LIS.

**Inizializzazione di MediaPipe:**
Il componente sfrutta le API di `@mediapipe/hands` e `@mediapipe/camera_utils`. Durante l'hook `useEffect` di mount iniziale, il potente motore MediaPipe viene istanziato e salvato a livello globale (`window.globalHandsInstance`) in modo da sopravvivere intatto anche ai re-render frequenti o i Fast Refresh causati da React, evitando memory leaks catastrofici. 
La telecamera viene gestita inglobandola nativamente dentro una `Camera` che intercetta i fotogrammi e li devia verso MediaPipe in maniera non bloccante:

```javascript
// Inizializza MediaPipe Hands per il rilevamento della mano (Singola Istanza)
const initializeMediaPipe = () => {
  if (!window.globalHandsInstance) {
    window.globalHandsInstance = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`
    });
    // Settato con precisione (Complexity 1) e ottimizzato per 1 sola mano (Max Performance)
    window.globalHandsInstance.setOptions({
      maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5
    });
  }
  window.globalHandsInstance.onResults(onResults); // Callback in loop sui fotogrammi

  // Avvia l'inquadratura associandola al Ref dell'elemento <video>
  startWebcam(window.globalHandsInstance);
};
```

**Estrazione, Normalizzazione Geometrica e Overlay Visivo (`<canvas>`):**
Ogni volta che MediaPipe individua lo scheletro della mano in un frame, evoca la callback di rendering `onResults`. Qui `LocalVideo.js` svolge tre compiti sequenziali e critici orchestrando un rudimentale `<video>` element oscurato e un `<canvas>` trasparente in overlay:
1. **Painting Grafico:** Usa le funzioni `drawing_utils` per disegnare a 60 FPS puliti i puntatori rossi sulle giunture e i legamenti verdi interpolati in realtime sul palmo, fornendo un feedback visivo irrinunciabile per l'utente, che saprà che il motore lo sta inquadrando in modo esatto. 
2. **Estrazione e Normalizzazione (Bounding-Box):** Preleva l'array dei 21 punti grezzi passati da Google. Scorre tutto, estrae la X e la Y calcolando matematicamente le coordinate minime (Bounding box *origin*). Subito dopo "sottrae" a tutti i landmark proprio quel minimo locale. Questo calcolo di *Normalizzazione Geometrica* garantisce che una vocale tracciata dal modello AI risulti strutturalmente identica a prescindere se l'utente ponga la mano in alto a sinistra o in centro. L'algoritmo restringe l'uscita da coordinate globali ad un flat-array finale (`data_aux`) composto ordinatamente da 42 float.
3. **Ponte di Comando col Web Worker:** Terminato il calcolo dello scheletro depurato e normalizzato, i dati vengono sparati immediatamente in un messaggio binario col metodo `postMessage` verso l'`inferenceWorker.js` nel backend Javascript separato, scaricando tutto il peso della Rete Neurale Tensor fuori dalla vista di React. Questo accade imperterrito per ogni frame catturato, fintanto non venga sganciato l'interruttore `aiEnabled` dalla UI.

Questo modulo garantisce che i pesanti e frequentissimi loop For annidati non intacchino in alcun modo il main loop dell'applicazione, permettendo al resto della pagina di scorrere fluida comportandosi a tutti gli effetti come un *Pure Render Component* reattivo a prescindere dal CPU load hardware.

### 1.5. `RemoteVideoGrid.js`: Rendering Dinamico della Classe Virtuale
Questo componente è incaricato di visualizzare tutti i partecipanti connessi alla stanza in qualità di *Subscriber*. Poiché i peer possono entrare e uscire in qualsiasi momento asincrono, la griglia video non è un layout statico ma puramente reattivo.

**Mappatura Dinamica (Object.entries) e Struttura dello Stato:**
Il componente riceve in ingresso la prop `remoteStreams`. Si tratta di un oggetto di stato (mappato dinamicamente in `VideoRoom`), le cui chiavi sono gli identificativi numerici generati da Janus e i valori sono **oggetti** con due campi:
- `stream`: l'istanza `MediaStream` con i track audio/video del partecipante
- `display`: il nome utente scelto dal partecipante nella `HomePage`

Sfruttando `Object.entries()`, il componente trasforma questa mappa in un array renderizzabile:

```javascript
export default function RemoteVideoGrid({ remoteStreams }) {
  const streamEntries = Object.entries(remoteStreams || {});

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
      {streamEntries.map(([id, entry]) => (
        <RemoteVideoPlayer key={id} id={id} stream={entry.stream} display={entry.display} />
      ))}
    </div>
  );
}
```

**Il Sottocomponente Singolo (`RemoteVideoPlayer`):**
Renderizzare fluidamente un flusso video mutante all'interno di un framework dichiarativo sfocia spesso in un problema tecnico insidioso: l'attributo `srcObject` del tag HTML5 `<video>` non è una *prop* serializzabile, ma richiede un'assegnazione imperativa al nodo DOM.
Per questo, la griglia astrae un sub-componente `RemoteVideoPlayer`. Al mounting, l'hook `useEffect` inietta il flusso WebRTC tramite `useRef`. Il componente mostra inoltre il **nome utente reale** del partecipante nel badge sotto il video:

```javascript
function RemoteVideoPlayer({ stream, display, id }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div>
      <video ref={videoRef} autoPlay playsInline />
      <div>{display || `Utente ${id}`}</div>
    </div>
  );
}
```
Questo garantisce che solo la cella dell'utente coinvolto venga ri-renderizzata quando cambia un track, senza ricaricare i video degli altri partecipanti.
Praticamente la funzione RemoteVideoPlayer riceve come prop lo stream video e lo assegna all'elemento <video> tramite useRef. Facciamo questo giro per mantenere il riferimento all'elemento HTML che contiene la stream video, in modo da poterlo riassegnare ogni volta che cambia la stream. Fare "src="video.mp4"" funzionerebbe ma avendo un oggetto che mappa gli utenti e le loro stream video, verrebbe ignorato da React. Grazie al riferimento all'elemento HTML, possiamo riassegnare la stream video ogni volta che cambia la stream.

---

## 2. Architettura di Rete: Janus WebRTC Server

Per gestire l'infrastruttura P2P e le stanze virtuali (VideoRoom), è stato integrato **Janus Gateway**.

### 2.1. Il Ruolo di Janus: Selective Forwarding Unit (SFU)
A differenza di un classico approccio WebRTC Mesh (dove ogni client è connesso direttamente a tutti gli altri con n*(n-1)/2 connessioni), il nostro progetto implementa una topologia "a stella" sfruttando Janus come **Selective Forwarding Unit (SFU)**.

In un'architettura SFU:
- Ogni client (browser) instaura **una singola connessione WebRTC** in upload (Publisher) per inviare i propri flussi (Webcam, Audio, DataChannel Testuale) al Server Janus.
- Il Server Janus agisce da "router multimediale": riceve i flussi da un utente e li inoltra (forwarding) a tutti gli altri membri della stanza.
- Ogni client instaura poi una connessione in download (Subscriber) per ogni altro partecipante attivo da cui desidera ricevere il flusso.

**Vantaggi per il nostro ecosistema LIS:**
1. **Risparmio Banda in Upload:** L'utente invia la propria telecamera una sola volta a prescindere da quanti siano gli spettatori.
2. **Scalabilità:** Permette lezioni/conferenze con un numero elevato di partecipanti senza saturare le connessioni casalinghe.

### 2.2. Il Plugin "VideoRoom"
Janus è un software modulare composto da plugin. Per questo progetto è stato scelto il **plugin `janus.plugin.videoroom`**, in quanto espone nativamente le API necessarie per simulare una "Classe Virtuale".

**Inizializzazione e Connessione (Signaling tramite WebSocket):**
Nel file `VideoRoom.js`, l'inizializzazione parte istanziando la libreria ufficiale `janus.js`.
La comunicazione di controllo (Signaling) tra l'app React e il Server Janus (situato su `wss://janus.conf.meetecho.com/ws`) avviene tramite **Secure WebSockets**. Attraverso i WebSocket scambiamo i pacchetti `SDP` (Session Description Protocol) per negoziare i codec audio/video e raccogliamo i candidati `ICE` per oltrepassare eventuali Firewall/NAT.

**Il Flusso "Publisher" (Chi trasmette):**
Al completamento dell'init Janus, il client si attacca al plugin e invia una richiesta `join` configurandosi come `publisher`. Subito dopo chiama `createOffer` usando la sintassi moderna dell'API **`tracks`**:
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

Se la telecamera non è disponibile, il codice usa un fallback **"Solo Dati"** specificando solo `{ type: 'data' }` nell'array `tracks`: la Chat P2P funziona comunque anche senza stream video/audio.

**I Flussi "Subscriber" (L'Ascolto):**
Quando Janus notifica la stanza che un nuovo utente è attivo (evento `publishers`), l'app React chiama `newRemoteFeed()`. Questa funzione lancia una nuova istanza del plugin `videoroom` come **subscriber**, usando la sintassi moderna con l'array `streams`:
```javascript
const subscribe = {
  request: "join",
  ptype: "subscriber",
  streams: [{ feed: publisherId }]
};
remoteFeed.send({ message: subscribe });
```
Janus risponde con un JSEP SDP offer. Il client risponde con un `createAnswer`, specificando solo `{ type: 'data' }`: i track audio e video remoti vengono **accettati automaticamente**.

**Gestione dei Track Remoti e delle Uscite:**
La callback `onremotetrack` viene invocata per ogni singolo `MediaStreamTrack` ricevuto. Ogni track viene aggiunto ad un `MediaStream` associato all'ID del publisher; il nome utente (`display`), trasmesso da Janus nell'evento `publishers`, viene memorizzato insieme allo stream nello stato `remoteStreams` come oggetto `{ stream, display }`. Questa struttura permette a `RemoteVideoGrid` di mostrare il nome scelto dall'utente nella `HomePage` direttamente sotto il suo video.
Quando un publisher lascia la stanza (evento `msg["leaving"]`), il client reagisce eliminando immediatamente l'entry di quell'utente dalla griglia React.

---

## 3. Gestione della Chat e Dati (DataChannel) e Accumulatore LIS (`ChatBox.js`)
Al completamento del giro di negoziazione ICE-SDP tra i Peer, Janus innesca l'evento `ondataopen` comunicando che il canale P2P bidirezionale `DataChannel` è stabile e pronto all'uso. In questo contesto, `ChatBox.js` funge non solo da UI testuale, ma da vero e proprio **Buffer Accumulatore** per il flusso costante di stringhe tradotte dall'Intelligenza Artificiale.

**L'Accumulatore Reattivo (`useEffect`):**
Invece di inviare i messaggi frammentati o ripetitivi in rete (spammando la chat comune), il componente deposita temporaneamente le traduzioni nello stato locale `draftMessage`. In ascolto sugli aggiornamenti della prop `currentSign`, un custom hook `useEffect` fa da _debouncer intelligente_:
Aggancia l'ultima predizione scartando i duplicati immediati (appoggiandosi alla cache sincrona `lastProcessedRef.current`) e concatena fluidamente i risultati nel campo di testo. Implementa inoltre una logica di formattazione che valuta se apporre uno spazio (in caso di parole intere riconosciute) o fondere la stringa (vitale per lo *spelling* dattilologico lettera per lettera):

```javascript
  // Accumula i segni LIS provenienti dal WebWorker
  useEffect(() => {
    if (currentSign && currentSign !== lastProcessedRef.current) {
      lastProcessedRef.current = currentSign; // Salvataggio cache per scartare doppioni

      setDraftMessage(prev => {
        // Se è una singola lettera attaccala unita, se è una parola anteponi lo spazio
        const spacer = (currentSign.length > 1 && prev.length > 0) ? " " : "";
        return prev + spacer + currentSign;
      });
    } else if (!currentSign) {
      lastProcessedRef.current = ""; // Reset del tracking quando la mano scompare
    }
  }, [currentSign]);
```

**Dinamica Ibrida di Invio (Human-in-the-Loop):**
Popolando un normale elemento `<input>` visibile a schermo, questo pattern restituisce all'utente il controllo assoluto del mezzo comunicativo. L'utente ha due opzioni senza soluzione di continuità:
1. Lasciar scorrere l'intera frase in LIS inquadrando le mani e avallarla alla fine col bottone Invia.
2. Contaminare l'input: la traduzione IA può essere bloccata o corretta sul momento digitando manualmente tramite tastiera per raffinare il contesto grammaticale del messaggio.

**Trasmissione P2P (Inondazione Dati):**
Alla pressione del tasto Invia (o del bottone *Enter* catturato via `handleKeyDown`), l'accumulatore viene svuotato e la stringa stringa validata "risale" (`State Lifting`) fino a `VideoRoom.js` richiamando la prop `onSendMessage(draftMessage)`.
Qui la logica di topologia SFU riprende il controllo: la stringa viene confezionata in un payload JSON pulito (`{"user": "Alice", "message": "Ciao a tutti"}`) e sparata nel tubo sfruttando la chiamata nativa `sfuPluginRef.current.data({ text: json_payload })`. Il Gateway Janus instraderà immediatamente in upload il frammento e lo rigetterà in download verso la griglia di tutti i *Subscriber* riducendo in latenza quasi zero l'intero ciclo di andata e ritorno, saltando qualsivoglia livello di *Persistence* in Database esterni classici.

---

## 4. Intelligenza Artificiale e WebAssembly (WASM) per l'Inferenza LIS

Per disaccoppiare e accelerare l'elaborazione dell'Intelligenza Artificiale (Riconoscimento LIS) dall'interfaccia utente React (UI), è stata utilizzata un'architettura basata su **WebAssembly (WASM)** e **Web Workers**.

### 4.1. Il Problema del Main Thread
Nativamente, le applicazioni web Javascript girano su un singolo thread (il *Main Thread*). Quando si introduce un motore di Machine Learning in tempo reale (come TensorFlow.js) per l'analisi dei fotogrammi video, i pesanti calcoli matriciali bloccano il thread. Questo genera rallentamenti (*stuttering*), ritardi nel rendering e un'interfaccia utente che non risponde ai comandi.

### 4.2. Web Workers (Isolamento del Processo)
Per risolvere questo problema, tutta la logica di TensorFlow è stata estratta da `LocalVideo.js` e spostata in un **Web Worker** dedicato (`src/workers/inferenceWorker.js`), permettendo di eseguire gli script in background.

**Flusso Dati Asincrono:**
1. React (in `LocalVideo.js` tramite MediaPipe) si limita a estrarre i 42 punti grezzi della mano a partire dal video acquisito tramite `getUserMedia`.
2. I landmark grezzi vengono inviati al Worker usando `postMessage(data)`.
3. Il Main Thread torna subito libero per aggiornare la UI a 60 FPS.
4. Il Worker, nel suo thread isolato, esegue l'inferenza valutando la classe d'appartenenza del gesto senza bloccare la UI.
5. Il Worker applica un "Filtro di Stabilità" (es. 15-50 frame consecutivi) per evitare frammentazioni (risolvendo il problema "grazie-ciao-ciao") e scartare falsi positivi durante i movimenti di transizione.
6. Quando viene riconosciuto e stabilizzato un segno, il Worker rispedisce la stringa pulita all'UI chiamando `postMessage({type: 'PREDICTION_RESULT', prediction})`. `LocalVideo.js` emette la stringa verso la `ChatBox` passando per `VideoRoom`.

### 4.3. TensorFlow.js WASM Backend (Accelerazione CPU)
Per impostazione predefinita, TensorFlow.js cerca di sfruttare la scheda video tramite WebGL. Per reti ottimizzate o ambienti privi di GPU dedicate, il calcolo CPU standard di Javascript risulta lento.
È stato quindi importato **`@tensorflow/tfjs-backend-wasm`**, la libreria ufficiale con i binari XNNPACK pre-compilati in C++ e convertiti in WebAssembly.
Chiamando `tf.setBackend('wasm')` nell'`inferenceWorker`, le operazioni matriciali vengono affidate ai file `.wasm`, sfruttando le istruzioni SIMD del processore del client ed eseguendo l'inferenza a velocità "near-native" svincolata dalla GPU.

### 4.4. Integrazione nel Bundler (Webpack Override)
Poiché i file `.wasm` sono binari, i bundler come quello di `create-react-app` tendono a ignorarli, causando Error 404.
Per risolvere questa problematica:
- È stato introdotto `react-app-rewired` e `copy-webpack-plugin`.
- È stato definito un file `config-overrides.js` per intercettare i file `tfjs-backend-wasm*.wasm` da `node_modules` e copiarli dinamicamente in `/static/js/` durante la build.
In questo modo il Web Worker ha l'autorizzazione a scaricarli localmente senza venir bloccato.

---

## Conclusioni
Rispetto ai prototipi iniziali, il passaggio ad un'architettura **App/HomePage/VideoRoom** ha trasformato il progetto in una solida applicazione multi-stanza. La netta separazione delle responsabilità tra Acquisizione/AI (`LocalVideo`, Worker), Signaling e Rete P2P (`VideoRoom`, Janus), e Rendering UI (`ChatBox`, `RemoteVideoGrid`, `HomePage`) rende il codice pulito, mantenibile e fortemente modulare.
