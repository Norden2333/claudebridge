import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const code = await fs.readFile(new URL('../extension/downloads.js', import.meta.url), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 2));
test('one-shot capture ignores unrelated downloads; completed Claude download uses native copy once; scope change cancels', async () => {
  const callbacks = {}, storage = {}, lookups = [], imports = []; let folder = '/selected'; let item;
  const self = { CFB_NATIVE_REQUEST: async (action, args) => { if (action === 'status') return { local: 'ready', scope:folder, config: { folder, allowWrites: true } }; imports.push(args); return { path: 'report.pdf', verified: true }; } };
  const chrome = { storage: { session: { set: async data => Object.assign(storage, data), get: async () => storage } }, downloads: { onCreated: { addListener: f => callbacks.created = f }, onChanged: { addListener: f => callbacks.changed = f }, search: async query => { lookups.push(query); return [item]; } } };
  vm.runInContext(code, vm.createContext({ self, chrome, URL, Date, crypto }));
  await self.CFB_DOWNLOADS.arm(); callbacks.created({ id: 1, startTime: new Date().toISOString(), url: 'https://unrelated.example/report.pdf', referrer: '' }); await tick(); assert.equal(storage.cfbDownload.status, 'armed'); assert.equal(lookups.length, 0);
  item = { id: 2, startTime: new Date().toISOString(), referrer: 'https://claude.ai/cowork/example', url: 'https://files.example/generated', state: 'complete', danger: 'safe', filename: '/downloads/report.pdf', exists: true };
  callbacks.created(item); for(let n=0;n<50 && storage.cfbDownload.status !== 'saved';n++) await tick(); assert.equal(storage.cfbDownload.status, 'saved'); assert.equal(imports.length, 1); assert.equal(lookups[0].id, 2);
  callbacks.changed({ id: 2, state: { current: 'complete' } }); await tick(); assert.equal(imports.length, 1);
  await self.CFB_DOWNLOADS.arm(); item = { ...item, id: 3, state: 'in_progress', startTime: new Date().toISOString() }; callbacks.created(item); for(let n=0;n<50 && storage.cfbDownload.status !== 'tracking';n++) await tick(); folder = '/other'; item.state = 'complete'; callbacks.changed({ id: 3, state: { current: 'complete' } }); for(let n=0;n<50 && storage.cfbDownload.status !== 'error';n++) await tick(); assert.equal(storage.cfbDownload.status, 'error'); assert.equal(imports.length, 1);
});
