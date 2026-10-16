import test from 'node:test';
import assert from 'node:assert/strict';
import {protectSession,unprotectSession} from '../companion/session-protection.mjs';
test('protected login round-trip stores no plaintext tokens and refuses old plaintext',async()=>{
 const session={access_token:'fake-access-not-a-real-token',refresh_token:'fake-refresh-not-a-real-token'};
 assert.equal(await unprotectSession(session),null);
 if(process.platform!=='win32')return; // Non-Windows OS vaults are exercised by injected synthetic adapters, never a user's real vault.
 const stored=await protectSession(session);
 assert.ok(!JSON.stringify(stored).includes('fake-access'));assert.ok(!JSON.stringify(stored).includes('fake-refresh'));
 assert.deepEqual(await unprotectSession(stored),session);
 await assert.rejects(unprotectSession({...stored,ciphertext:'invalid-data'}),/protection failed/);
});
