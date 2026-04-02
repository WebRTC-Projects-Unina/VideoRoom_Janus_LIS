# Integrazione WebAssembly (WASM) per l'Inferenza LIS

Questo documento illustra l'architettura tecnica utilizzata nel progetto per disaccoppiare e accelerare l'elaborazione dell'Intelligenza Artificiale (Riconoscimento LIS) dall'interfaccia utente React (UI), soddisfacendo così i requisiti didattici avanzati tramite l'utilizzo di **WebAssembly (WASM)** e **Web Workers**.

## Il Problema del Main Thread (Single-Threaded Javascript)
Nativamente, le applicazioni web Javascript girano su un singolo thread (il *Main Thread*). Questo thread ha il compito di ascoltare gli input dell'utente, aggiornare il DOM, renderizzare le animazioni CSS e scansionare i flussi video della webcam.
Quando si introduce un motore di Machine Learning in tempo reale (come TensorFlow.js) per l'analisi dei fotogrammi video, i pesanti calcoli matriciali bloccano il Main Thread. Questo fenomeno genera visibili rallentamenti (*stuttering*), ritardi nel rendering della telecamera ("lag") e un'interfaccia utente che cessa di rispondere ai click durante l'elaborazione dell'inferenza.

## La Soluzione Architetturale
Per rendere l'applicazione Reattiva ("Enterprise-grade"), abbiamo isolato completamente l'intelligenza artificiale in un ecosistema separato, affidandole un motore di calcolo compilato ad alte prestazioni. 

### 1. Web Workers (Isolamento del Processo)
Abbiamo estratto tutta la logica di TensorFlow dal componente React (`LocalVideo.js`) e l'abbiamo spostata all'interno di un **Web Worker** dedicato (`src/workers/inferenceWorker.js`).
Un Web Worker permette di eseguire script Javascript in thread in background ("OS-level multithreading") separati dal Main Thread della pagina web.

**Flusso Dati Asincrono:**
1. React (tramite MediaPipe) si limita a estrarre i 42 punti grezzi della mano (le sole features X, Y).
2. React invia i dati al Worker usando l'API nativa `postMessage(data)`.
3. Il Main Thread è subito di nuovo libero di disegnare la UI a 60 FPS.
4. Il Worker, nel suo thread isolato, esegue l'inferenza valutando la classe d'appartenenza del gesto.
5. Il Worker applica in autonomia un **Filtro di Stabilità** (es. richiede 50 frame consecutivi con alta confidenza) per scartare falsi positivi durante i movimenti di transizione della mano.
6. Solo a validazione avvenuta, il Worker rispedisce la traduzione testuale al React UI chiamando `postMessage({type: 'PREDICTION_RESULT', prediction})`.

### 2. TensorFlow.js WASM Backend (Accelerazione CPU)
Per impostazione predefinita, TensorFlow.js cerca di far girare le reti neurali sfruttando la scheda video tramite WebGL. Tuttavia, per reti Dense iper-ottimizzate o ambienti privi di schede grafiche dedicate, il calcolo CPU classico di Javascript risulta fino a 10 volte più lento rispetto ai linguaggi di basso livello (C++).

Per colmare questa lacuna, abbiamo importato **`@tensorflow/tfjs-backend-wasm`**.
Si tratta della libreria ufficiale che contiene i binari XNNPACK pre-compilati in C++ da Google e convertiti nel formato **WebAssembly (`.wasm`)**.

**Cos'è WebAssembly nel contesto IA?**
WebAssembly è un formato di istruzioni binario che permette di eseguire codice scritto in C/C++/Rust direttamente nei browser web.
Chiamando il comando `tf.setBackend('wasm')` all'interno dell'`inferenceWorker`, TensorFlow viene istruito a scartare il Javascript e affidare tutte le operazioni matriciali della rete neurale ai file compilati `.wasm`.

Il risultato è un motore di Intelligenza Artificiale front-end che sfrutta le istruzioni SIMD del processore del client, girando a velocità near-native completamente svincolato dalla CPU grafica.

### 3. Integrazione nel Bundler (Webpack Override)
Essendo `.wasm` file binari compilati e non testuali (come i normali file .js), i bundler di React (`react-scripts`) tendono a nasconderli o ignorarli per sicurezza durante il ciclo di build, causando Error 404 sul Browser.
Per risolvere questa problematica architetturale:
- È stato introdotto `react-app-rewired` e `copy-webpack-plugin`.
- È stato creato il file `config-overrides.js` alla radice del progetto.
- Il plugin è configurato per intercettare esplicitamente i file binari `tfjs-backend-wasm*.wasm` sepolti nella cartella `node_modules` e copiarli dinamicamente all'interno della directory pubblica `/static/js/` durante ogni build.

In questo modo il WebWorker ha l'autorizzazione a scaricarli localmente senza venir bloccato dalle policy del web-server localhost.