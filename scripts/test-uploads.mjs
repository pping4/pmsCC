/**
 * Sprint 5 Phase 2 — Acceptance tests for POST /api/uploads
 * Run: node scripts/test-uploads.mjs
 */

const BASE = process.env.BASE || 'http://localhost:3000';
const EMAIL = 'admin@pms.com';
const PASS = 'admin123';

const R='\x1b[31m', G='\x1b[32m', Y='\x1b[33m', X='\x1b[0m';
let passed=0, failed=0;
const fails=[];
function ok(label, val) {
  if (val) { console.log(`  ${G}OK${X} ${label}`); passed++; }
  else     { console.log(`  ${R}FAIL${X} ${label}`); failed++; fails.push(label); }
}
function info(m){ console.log(`  ${Y}..${X} ${m}`); }

let cookies = {};
function cookieHeader(){ return Object.entries(cookies).map(([k,v])=>`${k}=${v}`).join('; '); }
function absorb(res){
  const sc = res.headers.get('set-cookie');
  if (!sc) return;
  sc.split(',').forEach(c => {
    const [pair] = c.trim().split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) cookies[pair.slice(0,eq).trim()] = pair.slice(eq+1).trim();
  });
}
async function signIn(){
  const r1 = await fetch(`${BASE}/api/auth/csrf`);
  absorb(r1);
  const { csrfToken } = await r1.json();
  const r2 = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded', Cookie:cookieHeader()},
    body:new URLSearchParams({ csrfToken, email:EMAIL, password:PASS, redirect:'false', json:'true' }),
    redirect:'manual',
  });
  absorb(r2);
  const r3 = await fetch(`${BASE}/api/auth/session`, { headers:{Cookie:cookieHeader()} });
  const s = await r3.json();
  return s?.user ?? null;
}

async function upload({ size, mime, filename, purpose='payment_slip', withAuth=true }){
  const form = new FormData();
  const buf = Buffer.alloc(size, 0x42); // filled with 'B'
  form.append('file', new Blob([buf], { type: mime }), filename);
  form.append('purpose', purpose);
  const headers = withAuth ? { Cookie: cookieHeader() } : {};
  const res = await fetch(`${BASE}/api/uploads`, { method:'POST', body: form, headers, redirect:'manual' });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, data };
}

async function main(){
  // Wait for server to be ready
  for (let i=0; i<60; i++) {
    try {
      const r = await fetch(`${BASE}/api/auth/csrf`);
      if (r.ok) break;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
    if (i === 59) { console.log(`${R}server not ready${X}`); process.exit(1); }
  }
  info('server reachable');

  // Test 4: No session → auth gate enforced (307 via middleware or 401 from route)
  const noAuthRes = await upload({ size: 100, mime:'image/jpeg', filename:'a.jpg', withAuth: false });
  ok(`no-session → 307|401 auth gate  (got ${noAuthRes.status})`, noAuthRes.status === 307 || noAuthRes.status === 401);

  const user = await signIn();
  ok('sign-in as admin@pms.com', !!user);
  if (!user) process.exit(1);

  // Test 1: 4 MB JPG → 200
  const r1 = await upload({ size: 4*1024*1024, mime:'image/jpeg', filename:'slip.jpg' });
  ok(`4MB JPG → 200  (got ${r1.status})`, r1.status === 200);
  ok('response.url starts with /uploads/payment_slip/', r1.data?.url?.startsWith('/uploads/payment_slip/'));
  ok('response has filename+size+mime', !!r1.data?.filename && r1.data?.size === 4*1024*1024 && r1.data?.mime === 'image/jpeg');
  const url1 = r1.data?.url;

  // File accessible via static URL
  const fetched = await fetch(`${BASE}${url1}`);
  ok(`uploaded file reachable at ${url1}  (got ${fetched.status})`, fetched.status === 200);

  // Test 2: 6 MB JPG → 413
  const r2 = await upload({ size: 6*1024*1024, mime:'image/jpeg', filename:'big.jpg' });
  ok(`6MB JPG → 413  (got ${r2.status})`, r2.status === 413);

  // Test 3: .exe / application/x-msdownload → 415
  const r3 = await upload({ size: 1024, mime:'application/x-msdownload', filename:'bad.exe' });
  ok(`.exe mime → 415  (got ${r3.status})`, r3.status === 415);

  // Test 5: Two uploads → distinct UUIDs
  const rA = await upload({ size: 2048, mime:'image/png', filename:'a.png' });
  const rB = await upload({ size: 2048, mime:'image/png', filename:'b.png' });
  ok(`two uploads return 200/200  (${rA.status}/${rB.status})`, rA.status === 200 && rB.status === 200);
  ok(`distinct filenames  (${rA.data?.filename} vs ${rB.data?.filename})`, rA.data?.filename && rB.data?.filename && rA.data.filename !== rB.data.filename);
  ok(`distinct URLs`, rA.data?.url !== rB.data?.url);

  // Bonus: missing purpose → 400
  const r6 = await (async () => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.alloc(10)], { type:'image/jpeg' }), 'x.jpg');
    const res = await fetch(`${BASE}/api/uploads`, { method:'POST', body: form, headers:{Cookie:cookieHeader()} });
    return { status: res.status };
  })();
  ok(`missing purpose → 400  (got ${r6.status})`, r6.status === 400);

  // Bonus: purpose with path traversal → 400
  const r7 = await upload({ size: 10, mime:'image/jpeg', filename:'a.jpg', purpose:'../etc' });
  ok(`path-traversal purpose → 400  (got ${r7.status})`, r7.status === 400);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILURES:', fails); process.exit(1); }
}

main().catch(e => { console.error(e); process.exit(1); });
