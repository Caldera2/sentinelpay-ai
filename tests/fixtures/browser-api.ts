// Automated fixture: real Ed25519 signatures and SQL, simulated Solana RPC. No network transactions.
import fs from "node:fs/promises";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { encodeBase58,SOLANA_NETWORKS } from "@sentinelpay/shared";
import { createApp } from "../../apps/api/src/app";
import { createChain, paymentReference, type ReceiptExpectation } from "../../apps/api/src/services/chain";
import { config,database,testChain,transaction } from "../helpers";

async function main(){
  if(process.env.NODE_ENV==="production"||!process.env.TEST_DATABASE_URL)throw Error("Browser fixtures require a local TEST_DATABASE_URL and a non-production process.");
  if(!["127.0.0.1","localhost","[::1]"].includes(new URL(process.env.TEST_DATABASE_URL).hostname))throw Error("Browser fixtures only use a local database.");
  const root=process.cwd(),origin="http://127.0.0.1:3007",apiUrl="http://127.0.0.1:4007",proxySecret=randomBytes(32).toString("hex");
  const db=await database(),chain=testChain(),blockhash=Keypair.generate().publicKey.toBase58();
  const balances=new Map<string,bigint>(),references=new Map<string,string[]>(),prepared=new Map<string,ReceiptExpectation>();
  const balance=(wallet:string)=>balances.get(wallet)??100000000n;
  const digest=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
  let loseFirstBroadcastResponse=true;
  async function rpc(method:string,params:unknown[]){
    let result:unknown;
    if(method==="getGenesisHash")result=SOLANA_NETWORKS.devnet.genesisHash;
    else if(method==="getLatestBlockhash")result={context:{slot:100},value:{blockhash,lastValidBlockHeight:1000}};
    else if(method==="getBlockHeight")result=100;
    else if(method==="getBalance")result={context:{slot:100},value:1000000000};
    else if(method==="getVersion")result={"solana-core":"3.0.0","feature-set":1};
    else if(method==="getSignatureStatuses")result={context:{slot:100},value:(params[0] as string[]).map(signature=>chain.receipts.has(signature)?{slot:100,confirmations:null,confirmationStatus:"finalized",err:chain.receipts.get(signature)?.meta?.err||null,status:{Ok:null}}:null)};
    else if(method==="sendTransaction"){
      const tx=VersionedTransaction.deserialize(Buffer.from(params[0] as string,"base64")),message=tx.message.serialize(),expectation=prepared.get(digest(message));
      if(!expectation)throw Error("Fixture rejected an unprepared transaction.");
      for(let index=0;index<tx.message.header.numRequiredSignatures;index++){
        const key=createPublicKey({key:Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),tx.message.staticAccountKeys[index].toBuffer()]),format:"der",type:"spki"});
        if(!verify(null,message,key,tx.signatures[index]))throw Error("Fixture rejected an invalid wallet signature.");
      }
      const signature=encodeBase58(tx.signatures[0]);
      if(!chain.receipts.has(signature)){
        const amount=BigInt(expectation.amountAtomic);if(balance(expectation.payer)<amount)throw Error("Fixture wallet balance is insufficient.");
        balances.set(expectation.payer,balance(expectation.payer)-amount);balances.set(expectation.merchant,balance(expectation.merchant)+amount);
        const receipt=transaction(expectation);receipt.transaction.message.recentBlockhash=blockhash;receipt.transaction.signatures=[signature];chain.receipts.set(signature,receipt);
        const reference=paymentReference(expectation.memo).toBase58();references.set(reference,[...(references.get(reference)||[]),signature]);
      }
      if(loseFirstBroadcastResponse){loseFirstBroadcastResponse=false;console.log("Automated fixture: first broadcast response lost after settlement.");return {jsonrpc:"2.0",id:1,error:{code:-32000,message:"Automated lost broadcast response"}};}
      result=signature;
    }else throw Error("RPC method is not implemented by the isolated fixture.");
    return {jsonrpc:"2.0",id:1,result};
  }
  const rpcServer=await new Promise<Server>(resolve=>{const s=createServer(async(req,res)=>{
    try{let body="";for await(const part of req)body+=part;const request=JSON.parse(body);const response=await rpc(request.method,request.params||[]);res.setHeader("Content-Type","application/json");res.end(JSON.stringify({...response,id:request.id}));}
    catch{res.statusCode=400;res.end(JSON.stringify({error:"Automated RPC fixture rejected the request."}));}
  }).listen(0,"127.0.0.1",()=>resolve(s));});
  const builder=createChain({...config,rpcUrl:`http://127.0.0.1:${(rpcServer.address() as {port:number}).port}`});
  chain.buildPayment=async expectation=>{const built=await builder.buildPayment(expectation);const tx=VersionedTransaction.deserialize(Buffer.from(built.transaction,"base64"));prepared.set(digest(tx.message.serialize()),{...expectation,blockhash:built.blockhash});return built;};
  chain.balance=async wallet=>balance(wallet).toString();chain.rpc=rpc;chain.findReceipts=async reference=>references.get(reference)||[];
  const app=createApp(db,chain,{...config,appOrigin:origin,proxySecret});
  const server=app.listen(4007,"127.0.0.1",()=>console.log("Automated browser API listening on 127.0.0.1:4007; simulated chain, isolated PostgreSQL schema."));
  await fs.mkdir(path.join(root,"audit-output"),{recursive:true});await fs.writeFile(path.join(root,"audit-output/browser-fixture.json"),JSON.stringify({origin,apiUrl,proxySecret}));
  let stopping=false;async function stop(){if(stopping)return;stopping=true;await new Promise<void>(resolve=>server.close(()=>resolve()));await new Promise<void>(resolve=>rpcServer.close(()=>resolve()));await db.close();process.exit(0);}
  process.once("SIGTERM",()=>void stop());process.once("SIGINT",()=>void stop());
}
void main().catch(error=>{console.error("Browser fixture failed",{type:error?.name,code:error?.code});process.exitCode=1;});
