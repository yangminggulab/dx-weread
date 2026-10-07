import { React, useState } from './core/react.mjs';
import { PERSONAL_MODE, getAuthToken, clearAuthToken } from './core/api.mjs';
import { App } from './app/App.jsx';
import { LoginScreen } from './app/LoginScreen.jsx';

function Root() {
  const [authed, setAuthed] = useState(!PERSONAL_MODE || Boolean(getAuthToken()));
  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />;
  return <App onLogout={() => { clearAuthToken(); location.reload(); }} />;
}
globalThis.ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
