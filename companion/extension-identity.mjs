import crypto from 'node:crypto';
export function publicIdentity(input){
 if(typeof input!=='string'||Buffer.byteLength(input)>16384||input.includes('PRIVATE KEY'))throw new Error('只接受Chrome商店公开的公钥，不接受私钥。');
 const compact=input.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g,'');
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)||compact.length%4!==0)throw new Error('公钥格式无效。');
 let key;try{key=crypto.createPublicKey({key:Buffer.from(compact,'base64'),format:'der',type:'spki'});}catch{throw new Error('公钥不是有效的SPKI编码。');}
 if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength<2048)throw new Error('需要Chrome商店提供的RSA公钥。');
 const der=key.export({format:'der',type:'spki'}),publicKey=der.toString('base64');
 const extensionId=crypto.createHash('sha256').update(der).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
 return {extensionId,publicKey};
}
