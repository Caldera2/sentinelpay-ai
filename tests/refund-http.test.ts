import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createApp } from "../apps/api/src/app";
import { config,database,signingWallet,testChain } from "./helpers";

test("refund HTTP endpoints require a session, same origin and server-owned destination",async()=>{
 const db=await database();const server=await new Promise<Server>(resolve=>{const s=createApp(db,testChain(),config).listen(0,"127.0.0.1",()=>resolve(s));});
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 try{
  assert.equal((await fetch(base+"/refunds/pending")).status,401);assert.equal((await fetch(base+"/refunds/history")).status,401);
  const wallet=signingWallet(),headers={Origin:config.appOrigin,"Content-Type":"application/json"};
  const challenge=await(await fetch(base+"/auth/challenge",{method:"POST",headers,body:JSON.stringify({walletAddress:wallet.address})})).json() as {challengeId:string;message:string};
  const login=await fetch(base+"/auth/verify",{method:"POST",headers,body:JSON.stringify({challengeId:challenge.challengeId,signature:wallet.sign(challenge.message)})});
  const cookie=login.headers.get("set-cookie")!.split(";")[0],body={receiptId:crypto.randomUUID(),requestId:crypto.randomUUID(),amountUsdc:"1",reason:"Return"};
  const send=(extra:Record<string,unknown>,origin=config.appOrigin)=>fetch(base+"/refunds/transaction",{method:"POST",headers:{...headers,Origin:origin,Cookie:cookie},body:JSON.stringify({...body,...extra})});
  assert.equal((await send({destination:signingWallet().address})).status,400);
  assert.equal((await send({status:"confirmed"})).status,400);
  assert.equal((await send({},"https://untrusted.example")).status,403);
  assert.equal((await send({})).status,404);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await db.close();}
});
