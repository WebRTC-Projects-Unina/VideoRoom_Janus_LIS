# Implementazione Piattaforma LIS Connect (React + WebRTC + AI)

Questo documento descrive l'architettura aggiornata della piattaforma "LIS Connect", analizzando la struttura a componenti React e il flusso dati end-to-end, dalla selezione della stanza all'invio dei messaggi tradotti dall'Intelligenza Artificiale.

## Struttura dell'Applicazione

L'applicazione è sviluppata come una Single Page Application (SPA) in React. La logica di routing e gestione dello stato globale della sessione è centralizzata in `App.js`.

### 1. `App.js`: Gestore di Stato e Navigazione
Funge da entry-point dinamico. Mantiene lo stato della connessione corrente (`sessionData`) che contiene il nome dell'utente e l'ID della stanza.
- **Se `sessionData` è vuoto:** renderizza il componente `HomePage`.
- **Se `sessionData` è popolato:** renderizza il componente `VideoRoom`, passandogli i dati di sessione come `props`.

### 2. `HomePage.js`: Dati di Accesso
Componente di interfaccia iniziale (Landing Page) pulito ed essenziale.
Presenta all'utente due campi di input:
- **Nome Utente:** Il nome visualizzato in chat e associato al feed video remoto.
- **Numero Stanza:** L'ID intero della stanza virtuale Janus (es. `1234`). Se la stanza inserita non esiste sul server, viene creata dinamicamente.

Al submit del form, questi due valori vengono sollevati al padre (`App.js`) tramite la callback `onJoin`, innescando la transizione verso la VideoRoom.

### 3. `VideoRoom.js`: Il Cuore WebRTC (Stanza Virtuale)
Questo componente orchestra la comunicazione di rete (via Janus SFU) collegando l'utente al resto della stanza.

**Nuovo comportamento dinamico (tramite Props):**
A differenza delle versioni precedenti in cui stanza e nome erano *hardcoded*, ora `VideoRoom` riceve `username` e `roomID` nativamente da `HomePage`.
I riferimenti WebRTC (`MY_ROOM`, `myUsernameRef.current`) vengono inizializzati con questi parametri, permettendo la creazione infinita e dinamica di stanze separate, utile per scalare l'applicazione a vere aule scolastiche.

Il `VideoRoom` contiene al suo interno:
*   `<LocalVideo>`: Gestisce la webcam, l'elaborazione AI locale tramite WebWorker e l'interfaccia toggle per il traduttore LIS.
*   `<RemoteVideoGrid>`: Renderizza dinamicamente i `MediaStream` (audio/video) ricevuti dagli altri partecipanti connessi nella stessa `roomID`.
*   `<ChatBox>`: Visualizza la chat multi-utente trasmessa in P2P tramite DataChannel e permette l'invio sia manuale che guidato dall'AI.

Inoltre `VideoRoom` espone un bottone "Esci" (`onLeave`) che distrugge la sessione Janus e riporta l'utente alla `HomePage` resettando lo stato di `App.js`.

### 4. `LocalVideo.js` & `inferenceWorker.js`: Pipeline LIS
L'acquisizione del video (`getUserMedia`) avviene all'interno di `LocalVideo.js`.
Una volta ottenuto il permesso della camera:
1.  Ogni frame video viene processato localmente per individuare i landmark delle mani (tramite MediaPipe via WebAssembly).
2.  I landmark grezzi (sequenze temporali) vengono inviati tramite `postMessage` a un **Web Worker Dedicato** (`inferenceWorker.js`).
3.  Nel Worker, TensorFlow.js esegue le inferenze (riconoscimento del gesto) senza bloccare il thread principale della UI React.
4.  Il Worker applica un "Filtro di Stabilità" di 15 frame per evitare messaggi frammentati in chat (risolvendo il problema "grazie-ciao-ciao").
5.  Quando viene riconosciuto e stabilizzato un segno, il Worker invia la stringa pulita (es. "Ciao") indietro a `LocalVideo.js`.
6.  `LocalVideo.js` emette la stringa verso il contenitore padre `VideoRoom` tramite l'evento `onSignDetected`.

### 5. `ChatBox.js` e Invio Dati
Riceve il testo stabilizzato dall'AI (attraverso `currentSign`). La Chat offre all'utente due opzioni:
*   **Invio Traduzione LIS:** Cliccando sul badge col segno riconosciuto, la parola viene iniettata nel campo di testo, pronta per essere inviata.
*   **Invio Testuale Diretto:** L'utente può digitare normalmente con la tastiera.

Quando l'utente preme Invia (o Invio da tastiera), il testo viene sollevato fino a `VideoRoom.js` (tramite la prop `onSendMessage`), che lo inserisce nel pacchetto JSON (`{ user, message }`) e lo trasmette a inondazione a tutti gli spettatori utilizzando l'API `data()` di Janus.

---

## Conclusioni
Rispetto alla primissima implementazione, il passaggio ad un'architettura **App/HomePage/VideoRoom** trasforma il prototipo in una VERA applicazione multi-stanza, abbandonando l'uso di variabili globali/hardcoded. La netta separazione delle responsabilità tra Acquisizione/AI (`LocalVideo`, Worker), Signaling e Rete P2P (`VideoRoom`), e Rendering UI (`ChatBox`, `RemoteVideoGrid`, `HomePage`) rende il codice pulito, mantenibile e fortemente modulare.
