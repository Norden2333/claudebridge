import net from 'node:net';import tls from 'node:tls';import {Agent} from 'undici';
// RFC 1928 CONNECT only. Destination names go to the proxy, never local DNS.
function address(host){
 const ip=net.isIP(host);
 if(ip===4)return Buffer.from([1,...host.split('.').map(Number)]);
 if(ip===6){
  const expanded=host.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/,(_,a,b,c,d)=>((Number(a)<<8)|Number(b)).toString(16)+':'+((Number(c)<<8)|Number(d)).toString(16));
  const halves=expanded.split('::'),left=halves[0]?halves[0].split(':'):[],right=halves[1]?halves[1].split(':'):[];
  const words=halves.length===2?[...left,...Array(8-left.length-right.length).fill('0'),...right]:left;
  const out=Buffer.alloc(17);out[0]=4;words.forEach((w,i)=>out.writeUInt16BE(parseInt(w,16),1+i*2));return out;
 }
 const name=Buffer.from(host,'ascii');if(!name.length||name.length>255||/[^\x21-\x7e]/.test(host))throw new Error('SOCKS 目标地址无效。');return Buffer.concat([Buffer.from([3,name.length]),name]);
}
export function socksDispatcher(proxy){
 const u=new URL(proxy),host=u.hostname.replace(/^\[|\]$/g,'');
 if(!['socks5:','socks5h:'].includes(u.protocol)||!['127.0.0.1','::1'].includes(host)||!u.port||u.username||u.password)throw new Error('只支持无账号的本机 SOCKS5 入口。');
 return new Agent({connect(options,callback){
  let request;try{const target=options.hostname.replace(/^\[|\]$/g,''),port=Number(options.port||(options.protocol==='https:'?443:80));if(!Number.isInteger(port)||port<1||port>65535)throw new Error('目标端口无效');const tail=Buffer.alloc(2);tail.writeUInt16BE(port);request=Buffer.concat([Buffer.from([5,1,0]),address(target),tail]);}catch(e){callback(e,null);return;}
  const socket=net.connect({host,port:Number(u.port)});let stage=0,buffer=Buffer.alloc(0),done=false,tlsSocket;
  const timer=setTimeout(()=>fail(new Error('本机 SOCKS5 握手超时，未尝试直连。')),6000);
  function cleanup(){clearTimeout(timer);socket.removeListener('data',data);socket.removeListener('error',fail);socket.removeListener('end',ended);}
  function fail(error){if(done)return;done=true;cleanup();socket.destroy();tlsSocket?.destroy();callback(error,null);}
  function ended(){fail(new Error('本机 SOCKS5 在握手期间断开。'));}
  function ready(){
   socket.removeListener('data',data);socket.removeListener('end',ended);if(buffer.length)socket.unshift(buffer);socket.setNoDelay(true);
   if(options.protocol==='https:'){
    const target=options.hostname.replace(/^\[|\]$/g,'');tlsSocket=tls.connect({socket,host:target,servername:net.isIP(target)?undefined:(options.servername||target),rejectUnauthorized:true,ALPNProtocols:['http/1.1']});tlsSocket.once('error',fail);tlsSocket.once('secureConnect',()=>{if(done)return;done=true;cleanup();tlsSocket.removeListener('error',fail);callback(null,tlsSocket);});
   }else{done=true;cleanup();callback(null,socket);}
  }
  function data(chunk){
   buffer=Buffer.concat([buffer,chunk]);if(buffer.length>8192){fail(new Error('SOCKS5 握手响应过大。'));return;}
   if(stage===0){if(buffer.length<2)return;if(buffer[0]!==5||buffer[1]!==0){fail(new Error('本机 SOCKS5 需要认证或协议不支持，未尝试直连。'));return;}buffer=buffer.subarray(2);stage=1;socket.write(request);}
   if(stage===1){if(buffer.length<4)return;if(buffer[0]!==5||buffer[1]!==0||buffer[2]!==0){fail(new Error('本机 SOCKS5 拒绝连接，未尝试直连。'));return;}const size=buffer[3]===1?10:buffer[3]===4?22:buffer[3]===3&&buffer.length>=5?7+buffer[4]:null;if(size===null){if(buffer[3]===3&&buffer.length<5)return;fail(new Error('SOCKS5 响应格式无效。'));return;}if(buffer.length<size)return;buffer=buffer.subarray(size);stage=2;ready();}
  }
  socket.on('data',data);socket.once('error',fail);socket.once('end',ended);socket.once('connect',()=>socket.write(Buffer.from([5,1,0])));
 }});
}
