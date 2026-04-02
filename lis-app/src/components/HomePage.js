import React, { useState } from 'react';
const vocalisLogo = process.env.PUBLIC_URL + '/assets/vocalis-logo.png';


export default function HomePage({ onJoin }) {
    const [username, setUsername] = useState('');
    const [room, setRoom] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (username && room) {
            onJoin({ username, room: parseInt(room) });
        } else {
            alert("Per favore, inserisci sia il nome che il numero della stanza.");
        }
    };

    return (
        <div style={styles.container}>
            <div style={styles.card}>
                <img src={vocalisLogo} alt="Logo" style={styles.logo} />
                <p style={styles.subtitle}>Inserisci i dettagli per iniziare la sessione</p>

                <form onSubmit={handleSubmit} style={styles.form}>
                    <input
                        type="text"
                        placeholder="Il tuo Nome"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        style={styles.input}
                    />
                    <input
                        type="number"
                        placeholder="Numero Stanza (es. 1234)"
                        value={room}
                        onChange={(e) => setRoom(e.target.value)}
                        style={styles.input}
                    />
                    <button type="submit" style={styles.button}>
                        Entra nella Stanza
                    </button>
                </form>
                <p style={styles.footerText}>
                    Se la stanza non esiste, verrà creata automaticamente sul server Meetecho.
                </p>
            </div>
        </div>
    );
}

const styles = {
    container: { height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#A33DBD' },
    card: { padding: '40px', borderRadius: '12px', backgroundColor: 'white', boxShadow: '0 8px 24px rgba(0,0,0,0.1)', textAlign: 'center', maxWidth: '400px', width: '100%' },
    title: { color: '#1a73e8', marginBottom: '10px' },
    subtitle: { color: '#5f6368', marginBottom: '30px' },
    form: { display: 'flex', flexDirection: 'column', gap: '15px' },
    input: { padding: '12px', borderRadius: '6px', border: '1px solid #dadce0', fontSize: '16px' },
    button: { padding: '12px', borderRadius: '6px', border: 'none', backgroundColor: '#3BB39A', color: 'white', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' },
    logo: { width: '180px', height: 'auto' },
    footerText: { marginTop: '20px', fontSize: '12px', color: '#70757a' }
};