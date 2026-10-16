import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';import fs from 'node:fs/promises';import {publicIdentity} from '../companion/extension-identity.mjs';
test('public key derives the packaged Chrome identity without a private key',async()=>{
 const current=JSON.parse(await fs.readFile(new URL('../identity.json',import.meta.url),'utf8'));assert.deepEqual(publicIdentity(current.publicKey),current);
 const key=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).publicKey;const pem=key.export({format:'pem',type:'spki'}),derived=publicIdentity(pem);assert.match(derived.extensionId,/^[a-p]{32}$/);assert.equal(publicIdentity(derived.publicKey).extensionId,derived.extensionId);
});
test('publisher preparation refuses private, invalid and oversized keys',()=>{
 assert.throws(()=>publicIdentity('-----BEGIN PRIVATE KEY-----'));assert.throws(()=>publicIdentity('not a public key'));assert.throws(()=>publicIdentity('A'.repeat(20000)));
});
