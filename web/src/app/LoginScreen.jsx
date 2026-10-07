import { React, useState } from '../core/react.mjs';
import { apiUrl, setAuthToken } from '../core/api.mjs';
function LoginScreen({ onLogin }) {
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async e => {
    e.preventDefault();
    const password = pwd.trim();
    if (!password) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(apiUrl('/api/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        setAuthToken(data.token);
        onLogin();
      } else {
        setError('密码错误');
      }
    } catch { setError('网络错误，请重试'); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas">
      <div className="bg-paper rounded-2xl shadow-sm border border-line p-8 w-full max-w-xs">
        <div className="flex justify-center mb-4">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
            </svg>
          </div>
        </div>
        <h1 className="serif text-lg font-semibold text-ink mb-6 text-center">My Project Library</h1>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={pwd}
            onChange={e => { setPwd(e.target.value); setError(''); }}
            placeholder="访问密码"
            className="w-full px-3.5 py-2.5 rounded-lg border border-line text-sm bg-surface text-body placeholder-placeholder"
            autoFocus
          />
          {error && <p className="text-xs text-danger text-center">{error}</p>}
          <button
            type="submit"
            disabled={loading || !pwd.trim()}
            className="w-full py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors disabled:opacity-40"
          >
            {loading ? '验证中…' : '进入'}
          </button>
        </form>
      </div>
    </div>
  );
}

export { LoginScreen };
