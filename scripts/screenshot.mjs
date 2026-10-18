// node shot.mjs <title-substring> <out.png> ['js to eval first']
const [,, match, out, js] = process.argv;
const list = await (await fetch(`http://127.0.0.1:${process.env.AIM_PORT || 9334}/json/list`)).json();
const p = list.find(p => p.type === 'page' && (p.title.includes(match) || p.url.includes(match)));
if (!p) { console.log('pages:', list.map(p => p.title + ' ' + p.url.split('/').pop()).join(' | ')); process.exit(1); }
const ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const send = (method, params = {}) => new Promise(r => { const i = ++id; ws.addEventListener('message', function h(e) { const m = JSON.parse(e.data); if (m.id === i) { ws.removeEventListener('message', h); r(m.result); } }); ws.send(JSON.stringify({ id: i, method, params })); });
if (js) { const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true }); console.log('eval:', JSON.stringify(r.result?.value ?? r.exceptionDetails?.exception?.description)); }
if (out !== '-') { const r = await send('Page.captureScreenshot', { format: 'png' }); (await import('fs')).writeFileSync(out, Buffer.from(r.data, 'base64')); }
ws.close();
