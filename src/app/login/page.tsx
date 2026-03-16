'use client';

import { useState, FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@pms.com');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    setLoading(false);
    if (result?.error) {
      setError('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    } else {
      router.push('/rooms');
      router.refresh();
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 50%, #2563eb 100%)',
      padding: 16,
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 20,
        padding: '40px 36px',
        width: '100%',
        maxWidth: 420,
        boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16,
            background: 'linear-gradient(135deg, #1e40af, #3b82f6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px', fontSize: 28,
          }}>🏨</div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: '#111827' }}>PMS</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>Service Apartment Management</p>
        </div>

        {error && (
          <div style={{
            background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: 10, padding: '10px 14px', marginBottom: 16,
            fontSize: 13, color: '#dc2626',
          }}>
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }}>
              อีเมล
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              style={{
                width: '100%', padding: '11px 14px',
                border: '1.5px solid #d1d5db', borderRadius: 10,
                fontSize: 14, outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }}>
              รหัสผ่าน
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={{
                width: '100%', padding: '11px 14px',
                border: '1.5px solid #d1d5db', borderRadius: 10,
                fontSize: 14, outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '13px',
              background: loading ? '#93c5fd' : '#1e40af',
              color: '#fff', border: 'none', borderRadius: 10,
              fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>

        <div style={{
          marginTop: 20, padding: '12px 14px',
          background: '#f0f9ff', borderRadius: 10, fontSize: 12, color: '#0369a1',
        }}>
          <strong>Demo:</strong> admin@pms.com / admin123
        </div>
      </div>
    </div>
  );
}
