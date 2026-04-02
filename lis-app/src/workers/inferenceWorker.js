/* eslint-disable no-restricted-globals */

import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import '@tensorflow/tfjs-backend-wasm';

let model = null;
let classesMap = {};

// Filtro di stabilità: emette una predizione solo dopo 50 frame consecutivi uguali con alta confidenza
let lastPrediction = "";
let stableCount = 0;
const STABILITY_THRESHOLD = 50;

const SIGN2TEXT_LABELS = {
    0: 'A', 1: 'B', 2: 'C', 3: 'D', 4: 'E', 5: 'F', 6: 'G', 7: 'H', 8: 'I', 9: 'J',
    10: 'K', 11: 'L', 12: 'M', 13: 'N', 14: 'O', 15: 'P', 16: 'Q', 17: 'R', 18: 'S',
    19: 'T', 20: 'U', 21: 'V', 22: 'W', 23: 'X', 24: 'Y', 25: 'Z', 26: 'Hello',
    27: 'Done', 28: 'Thank You', 29: 'I Love you', 30: 'Sorry', 31: 'Please',
    32: 'You are welcome.'
};

async function init() {
    try {
        setWasmPaths('/static/js/');
        await tf.setBackend('wasm');
        const backend = tf.getBackend();

        const [modelResp, classesResp] = await Promise.all([
            tf.loadLayersModel('/tfjs_sign2text_model/model.json'),
            fetch('/sign2text_classes.json').then(res => res.json())
        ]);

        model = modelResp;
        classesMap = classesResp;

        self.postMessage({ type: 'STATUS', status: 'READY', backend: backend });

    } catch (error) {
        console.error("Errore nel caricamento WASM/IA: ", error);
        self.postMessage({ type: 'STATUS', status: 'ERROR', error: error.message });
    }
}

init();

self.onmessage = (event) => {
    const { type, data_aux } = event.data;

    if (type === 'PREDICT' && model && data_aux) {
        tf.tidy(() => {
            const inputTensor = tf.tensor([data_aux]);
            const result = model.predict(inputTensor);
            const rawProbabilities = result.arraySync()[0];

            const maxProbIndex = rawProbabilities.indexOf(Math.max(...rawProbabilities));
            const maxProb = rawProbabilities[maxProbIndex];
            const predictedClassText = SIGN2TEXT_LABELS[parseInt(classesMap[String(maxProbIndex)])];

            if (maxProb > 0.95) {
                if (predictedClassText === lastPrediction) {
                    stableCount += 1;
                    // Emette il risultato solo al raggiungimento della soglia di stabilità
                    if (stableCount === STABILITY_THRESHOLD) {
                        self.postMessage({
                            type: 'PREDICTION_RESULT',
                            prediction: predictedClassText,
                            confidence: maxProb,
                        });
                    }
                } else {
                    lastPrediction = predictedClassText;
                    stableCount = 1;
                }
            } else {
                // Confidenza bassa: resetta il filtro e notifica che non c'è nessun segno
                if (lastPrediction !== "") {
                    lastPrediction = "";
                    stableCount = 0;
                    self.postMessage({ type: 'SIGN_CLEARED' });
                }
            }
        });
    }
};
