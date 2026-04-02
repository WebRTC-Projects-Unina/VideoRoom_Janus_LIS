import { useState, useEffect, useRef } from 'react';

export default function ChatBox({ currentSign, messages, onSendMessage }) {
  const [draftMessage, setDraftMessage] = useState("");
  const lastProcessedRef = useRef("");

  // Invia il messaggio alla VideoRoom per la rete
  const sendMessage = (textToSend) => {
    if (!textToSend.trim()) return;
    if (onSendMessage) onSendMessage(textToSend.trim());
    setDraftMessage("");
    lastProcessedRef.current = "";
  };

  // Gestione dell'Input Manuale da Tastiera
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendMessage(draftMessage);
    }
  };

  // Accumula i segni LIS provenienti dal WebWorker
  useEffect(() => {
    if (currentSign && currentSign !== lastProcessedRef.current) {
      // Evita di stampare lettere uguali
      lastProcessedRef.current = currentSign;

      setDraftMessage(prev => {
        // Se è una singola lettera attaccala, se è una parola metti lo spazio
        const spacer = (currentSign.length > 1 && prev.length > 0) ? " " : "";
        return prev + spacer + currentSign;
      });
    } else if (!currentSign) {
      // Quando non c'è nessuna mano azzeriamo 
      lastProcessedRef.current = "";
    }
  }, [currentSign]);

  return (
    <div style={{ padding: '10px', borderRadius: '8px' }}>
      <h3 style={{ margin: '0 0 10px 0', color: '#A33DBD' }}>Traduzione LIS / Chat Globale</h3>

      <div style={{ height: '200px', backgroundColor: '#f9f9f9', padding: '10px', overflowY: 'auto', border: '1px solid #ccc', marginBottom: '10px' }}>
        {messages.length === 0 ? (
          <p style={{ color: '#888', fontStyle: 'italic' }}>Nessun messaggio. Inizia a segnare o digitare...</p>
        ) : (
          messages.map((m, idx) => (
            <div key={idx} style={{ padding: '5px', borderBottom: '1px solid #eee' }}>
              <strong>{m.sender}:</strong> {m.text}
            </div>
          ))
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px' }}>
        <input
          type="text"
          value={draftMessage}
          onChange={(e) => setDraftMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Componi la frase a gesti o premi Invio per inviare..."
          style={{ flexGrow: 1, padding: '10px', fontSize: '16px', borderRadius: '4px', border: '1px solid #aaa' }}
        />
        <button
          onClick={() => sendMessage(draftMessage)}
          style={{ padding: '10px 20px', backgroundColor: '#3BB39A', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          Invia
        </button>
      </div>
    </div>
  );
}