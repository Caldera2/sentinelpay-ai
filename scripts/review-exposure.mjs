import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createPrivateKey, createPublicKey, verify, createHash } from "node:crypto";
import { createRequire } from "node:module";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
process.on("uncaughtException",error=>{console.error("Exposure review failed",{type:error?.name,code:error?.code});process.exit(1);});
const require=createRequire(import.meta.url);
const {encodeBase58,SOLANA_NETWORKS}=require("../packages/shared/dist");
const historical=(name)=>execFileSync("git",["show",`HEAD:${name}`],{cwd:root,encoding:"utf8",maxBuffer:1_000_000});
const env=Object.fromEntries(historical(".vercel.prod.env").split(/\r?\n/).map(line=>line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].replace(/^"|"$/g,"")]));
const bytes=Buffer.from(JSON.parse(historical("target/deploy/sentinelpay-keypair.json")));
if(bytes.length!==64)throw Error("Historical key has an unexpected format.");
const privateKey=createPrivateKey({key:Buffer.concat([Buffer.from("302e020100300506032b657004220420","hex"),bytes.subarray(0,32)]),format:"der",type:"pkcs8"});
const derived=createPublicKey(privateKey).export({format:"der",type:"spki"}).subarray(-32);
if(!derived.equals(bytes.subarray(32)))throw Error("Historical public key does not match its seed.");
const address=encodeBase58(derived);
const report={reviewedAt:new Date().toISOString(),publicAddress:address,oidc:null,rpc:null,networks:[]};
if(env.NEXT_PUBLIC_SOLANA_RPC_URL){
 try{const u=new URL(env.NEXT_PUBLIC_SOLANA_RPC_URL.trim());report.rpc={host:u.hostname,queryKeys:[...u.searchParams.keys()],knownPublicEndpoint:["api.devnet.solana.com","api.mainnet-beta.solana.com","api.testnet.solana.com"].includes(u.hostname)&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==="/"};}
 catch{const fingerprint=createHash("sha256").update(env.NEXT_PUBLIC_SOLANA_RPC_URL.trim()).digest("hex");report.rpc={validUrl:false,placeholderConfirmed:fingerprint==="37f1d9c75f510aca9c3d7be733ae7e9ae723973f2ada3f67eeb99cddd00db201",sha256:fingerprint};}
}
const token=env.VERCEL_OIDC_TOKEN;
if(token){const [headerPart,claimsPart,signaturePart]=token.split(".");const header=JSON.parse(Buffer.from(headerPart,"base64url"));const claims=JSON.parse(Buffer.from(claimsPart,"base64url"));
 report.oidc={issuer:claims.iss,expiresAt:new Date(claims.exp*1000).toISOString(),expired:claims.exp*1000<Date.now(),signatureVerified:false,signingKeyPresent:null};
 if(process.argv.includes("--online")&&/^https:\/\/oidc\.vercel\.com(?:\/[a-zA-Z0-9_-]+)?$/.test(claims.iss))try{
  const discovery=await fetch(claims.iss+"/.well-known/openid-configuration",{signal:AbortSignal.timeout(15000)}).then(r=>r.json());
  const uri=new URL(discovery.jwks_uri);if(uri.origin!=="https://oidc.vercel.com")throw Error("Unexpected JWKS host.");
  const jwks=await fetch(uri,{signal:AbortSignal.timeout(15000)}).then(r=>r.json());const key=jwks.keys.find(k=>k.kid===header.kid);report.oidc.signingKeyPresent=Boolean(key);
  if(key&&header.alg==="RS256")report.oidc.signatureVerified=verify("RSA-SHA256",Buffer.from(headerPart+"."+claimsPart),createPublicKey({key,format:"jwk"}),Buffer.from(signaturePart,"base64url"));
 }catch(error){report.oidc.onlineError=error.name;}
}
if(process.argv.includes("--online"))for(const [cluster,url] of [["devnet","https://api.devnet.solana.com"],["mainnet-beta","https://api.mainnet-beta.solana.com"]]){
 const network={cluster};let id=0;
 async function rpc(method,params){const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:++id,method,params}),signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error(`RPC HTTP ${response.status}`);const body=await response.json();if(body.error)throw Error(`RPC error ${body.error.code}`);return body.result;}
 try{
  const genesis=await rpc("getGenesisHash",[]);if(genesis!==SOLANA_NETWORKS[cluster].genesisHash)throw Error("RPC network mismatch");
  const account=(await rpc("getAccountInfo",[address,{encoding:"base64",commitment:"finalized"}])).value;
  network.account=account?{owner:account.owner,executable:account.executable,lamports:account.lamports}:null;
  network.tokenAccounts=[];
  for(const programId of ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA","TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]){
   const accounts=await rpc("getTokenAccountsByOwner",[address,{programId},{encoding:"jsonParsed",commitment:"finalized"}]);
   network.tokenAccounts.push(...accounts.value.map(a=>({address:a.pubkey,mint:a.account.data.parsed.info.mint,amount:a.account.data.parsed.info.tokenAmount.amount})));
  }
  const loader="BPFLoaderUpgradeab1e11111111111111111111111";
  network.upgradeAuthorityReview={};
  try{const programs=await rpc("getProgramAccounts",[loader,{encoding:"base64",commitment:"finalized",dataSlice:{offset:0,length:45},filters:[{memcmp:{offset:13,bytes:address}}]}]);
   network.upgradeAuthorityReview.controlledProgramData=programs.filter(a=>{const b=Buffer.from(a.account.data[0],"base64");return b.length>=45&&b.readUInt32LE(0)===3&&b[12]===1&&encodeBase58(b.subarray(13,45))===address;}).map(a=>a.pubkey);
  }catch(error){network.upgradeAuthorityReview.error=error.message;}
  network.reviewComplete=true;
 }catch(error){network.error=error.message;network.reviewComplete=false;}
 report.networks.push(network);
}
await fs.mkdir(path.join(root,"audit-output"),{recursive:true});
await fs.writeFile(path.join(root,"audit-output/exposure-review.json"),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
