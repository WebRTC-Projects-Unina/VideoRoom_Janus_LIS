import React, { useEffect, useRef } from 'react';


function RemoteVideoPlayer({ stream, display, id }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div style={{ margin: '10px', display: 'inline-block', backgroundColor: '#000', borderRadius: '8px', overflow: 'hidden' }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{ width: '320px', height: '240px', objectFit: 'cover' }}
      />
      <div style={{ backgroundColor: '#2196F3', color: 'white', padding: '5px', textAlign: 'center', fontWeight: 'bold' }}>
        {display || `Utente ${id}`}
      </div>
    </div>
  );
}

export default function RemoteVideoGrid({ remoteStreams }) {
  const streamEntries = Object.entries(remoteStreams || {});

  return (
    <div style={{ padding: '10px', borderRadius: '8px', minHeight: '300px' }}>
      <h3 style={{ margin: '0 0 10px 0', color: '#A33DBD' }}>Classe Virtuale (Janus SFU)</h3>

      {streamEntries.length === 0 ? (
        <p style={{ color: '#888', fontStyle: 'italic' }}>Nessun altro utente collegato. Attesa partecipanti...</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          {streamEntries.map(([id, entry]) => (
            <RemoteVideoPlayer key={id} id={id} stream={entry.stream} display={entry.display} />
          ))}
        </div>
      )}
    </div>
  );
}