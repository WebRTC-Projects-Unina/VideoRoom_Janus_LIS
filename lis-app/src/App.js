import React, { useState } from 'react';
import HomePage from './components/HomePage';
import VideoRoom from './components/VideoRoom';

function App() {
  const [session, setSession] = useState(null);

  if (!session) {
    return <HomePage onJoin={(data) => setSession(data)} />;
  }

  return (
    <VideoRoom
      roomID={session.room}
      username={session.username}
      onLeave={() => setSession(null)}
    />
  );
}

export default App;