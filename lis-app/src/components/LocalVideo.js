import { useEffect, useRef, useState } from 'react';
import { Hands, HAND_CONNECTIONS } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';

export default function LocalVideo({ onSignDetected, aiEnabled }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const handsRef = useRef(null);
  const cameraRef = useRef(null);

  const [prediction, setPrediction] = useState("");
  const [confidence, setConfidence] = useState(0);
  const [engineStatus, setEngineStatus] = useState("Inizializzazione Motore WASM...");

  const aiEnabledRef = useRef(aiEnabled);
  const onSignDetectedRef = useRef(onSignDetected);

  useEffect(() => {
    aiEnabledRef.current = aiEnabled;
    onSignDetectedRef.current = onSignDetected;
  }, [aiEnabled, onSignDetected]);

  const workerRef = useRef(null);

  useEffect(() => {
    workerRef.current = new Worker(new URL('../workers/inferenceWorker.js', import.meta.url));

    workerRef.current.onmessage = (event) => {
      const { type, status, prediction, confidence, backend, error } = event.data;

      if (type === 'STATUS') {
        if (status === 'READY') {
          setEngineStatus(`Motore AI Attivo (Backend: ${backend})`);
          console.log("Connessione con il Worker WASM stabilita!");
        } else {
          setEngineStatus("Errore WASM: " + error);
        }
      }

      // Il worker ci ha inviato il risultato
      if (type === 'PREDICTION_RESULT') {
        setPrediction(prediction);
        setConfidence(Math.round(confidence * 100));
        if (onSignDetectedRef.current) onSignDetectedRef.current(prediction);
      }

      // Il worker ci dice che non c'è attività 
      if (type === 'SIGN_CLEARED') {
        setPrediction("");
        setConfidence(0);
        if (onSignDetectedRef.current) onSignDetectedRef.current("");
      }
    };

    // Inizializza MediaPipe Hands per il rilevamento della mano
    const initializeMediaPipe = () => {
      // Persiste su window per sopravvivere ai Fast Refresh di React
      if (!window.globalHandsInstance) {
        window.globalHandsInstance = new Hands({
          locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`;
          }
        });

        window.globalHandsInstance.setOptions({
          maxNumHands: 1,
          modelComplexity: 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
      }

      window.globalHandsInstance.onResults(onResults);
      handsRef.current = window.globalHandsInstance;

      startWebcam(window.globalHandsInstance);
    };

    const startWebcam = (handsInstance) => {
      if (videoRef.current) {
        const camera = new Camera(videoRef.current, {
          onFrame: async () => {
            if (videoRef.current && handsInstance) {
              await handsInstance.send({ image: videoRef.current });
            }
          },
          width: 640,
          height: 480
        });
        camera.start(); // anche questa astrae getUserMedia()
        cameraRef.current = camera;
      }
    };

    initializeMediaPipe();

    return () => {
      if (cameraRef.current) cameraRef.current.stop();
      if (window.globalHandsInstance) {
        window.globalHandsInstance.close();
        window.globalHandsInstance = null;
      }
      if (workerRef.current) workerRef.current.terminate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onResults = (results) => {
    if (!canvasRef.current || !videoRef.current) return;
    const canvasCtx = canvasRef.current.getContext('2d');
    canvasRef.current.width = videoRef.current.videoWidth || 640;
    canvasRef.current.height = videoRef.current.videoHeight || 480;

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

    let data_aux = [];
    let x_List = [];
    let y_List = [];

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const handLandmarks = results.multiHandLandmarks[0];

      // Disegna scheletro
      drawConnectors(canvasCtx, handLandmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 3 });
      drawLandmarks(canvasCtx, handLandmarks, { color: '#FF0000', lineWidth: 2, radius: 4 });

      // Fase 1: Trova il "minimo" per ritagliare l'ingombro
      for (let i = 0; i < handLandmarks.length; i++) {
        x_List.push(handLandmarks[i].x);
        y_List.push(handLandmarks[i].y);
      }
      const min_X = Math.min(...x_List);
      const min_Y = Math.min(...y_List);

      // Fase 2: Costruisci l'array finale normalizzato
      for (let i = 0; i < handLandmarks.length; i++) {
        data_aux.push(handLandmarks[i].x - min_X);
        data_aux.push(handLandmarks[i].y - min_Y);
      }

      // Invia i keypoint al WebWorker WASM (solo se l'IA è attiva)
      if (aiEnabledRef.current && data_aux.length === 42 && workerRef.current) {
        workerRef.current.postMessage({ type: 'PREDICT', data_aux: data_aux });
      } else if (!aiEnabledRef.current) {
        // IA disattivata: azzera la UI e notifica ChatBox
        setPrediction("");
        setConfidence(0);
        if (onSignDetectedRef.current) onSignDetectedRef.current("");
      }

    } else {
      setPrediction("");
      setConfidence(0);
    }
    canvasCtx.restore();
  };

  return (
    <div style={{ borderRadius: '8px', width: '100%', position: 'relative' }}>
      <div style={{ marginBottom: '5px', fontSize: '12px', color: '#ff5722', fontWeight: 'bold' }}>
        {/*engineStatus*/}
      </div>
      <div style={{ minHeight: '60px', marginBottom: '10px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#eef4f3ff', borderRadius: '5px' }}>
        <div>
          <strong>Parola Interpretata: </strong>
          <span style={{ fontSize: '28px', fontWeight: 'bold', color: '#3BB39A', marginLeft: '10px' }}>
            {prediction || "Nessuna Mano..."}
          </span>
        </div>
        {confidence > 0 && (
          <div style={{ fontSize: '14px', color: '#3BB39A' }}>
            Accuratezza: {confidence}%
          </div>
        )}
      </div>
      <div style={{ position: 'relative', width: '100%' }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: '100%', display: 'block', transform: 'scaleX(-1)' }}
        />
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', transform: 'scaleX(-1)' }}
        />
      </div>
    </div>
  );
}