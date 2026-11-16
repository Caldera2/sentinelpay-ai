import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Database } from "../apps/api/src/lib/db";
import { createInvoiceService } from "../apps/api/src/services/invoiceService";
import { createRefundService } from "../apps/api/src/services/refundService";
import { reconcileRefundsOnce } from "../apps/api/src/services/reconciler";
import { config, database, signingWallet, testChain, transaction } from "./helpers";
let db:Database;
before(async()=>{db=await database();});after(async()=>{await db.close();});
beforeEach(async()=>{await db.query("TRUNCATE merchants,auth_challenges,sessions,invoices,payment_attempts,audit_events RESTART IDENTITY CASCADE");});
async function setup(paid=true,received="10000000"){
 const merchant=signingWallet().address,payer=signingWallet().address;await db.query("INSERT INTO merchants(wallet) VALUES($1)",[merchant]);
 const chain=testChain(),invoices=createInvoiceService(db,chain,config),refunds=createRefundService(db,chain,config);
 const invoice=await invoices.create(merchant,"Refundable order","10",24,randomUUID()),attempt=await invoices.prepare(invoice.id,payer,undefined,randomUUID());
 const signature="2".repeat(88);chain.receipts.set(signature,transaction(chain.built[0],received));
 const receiptId=paid?(await invoices.confirm(invoice.id,attempt.attemptId,signature)).receiptId:"";
 return {merchant,payer,chain,invoices,refunds,invoice,attempt,receiptId,signature};
}
test("refund preparation is idempotent, merchant-scoped, and bound to the original payer",async()=>{
 const {merchant,payer,refunds,receiptId,chain}=await setup(),id=randomUUID();
 await assert.rejects(refunds.prepare(signingWallet().address,receiptId,"1","Return",randomUUID()),/not found/);
 const first=await refunds.prepare(merchant,receiptId,"4","Partial return",id);
 assert.equal(first.destination,payer);assert.equal(first.amountAtomic,"4000000");
 assert.deepEqual(await refunds.prepare(merchant,receiptId,"4","Partial return",id),first);assert.equal(chain.built.length,2);
 await assert.rejects(refunds.prepare(merchant,receiptId,"5","Partial return",id),/already used/);
 assert.equal(chain.built[1].payer,merchant);assert.equal(chain.built[1].merchant,payer);
});
test("partial and full refunds update net revenue once and cannot exceed the received amount",async()=>{
 const {merchant,refunds,receiptId,chain,invoices}=await setup();
 const refund=await refunds.prepare(merchant,receiptId,"4","Partial return",randomUUID()),signature="3".repeat(88);
 await assert.rejects(refunds.confirm(merchant,refund.id,signature),/awaiting final confirmation/);
 assert.equal((await refunds.pending(merchant))?.submittedSignature,signature);
 chain.receipts.set(signature,transaction(chain.built[1]));
 await Promise.all([refunds.confirm(merchant,refund.id,signature),refunds.confirm(merchant,refund.id,signature)]);
 assert.equal((await invoices.summary(merchant)).revenueAtomic,"6000000");
 assert.equal((await db.query("SELECT id FROM audit_events WHERE action='refund.confirmed'")).rows.length,1);
 await assert.rejects(refunds.prepare(merchant,receiptId,"6.000001","Too much",randomUUID()),/exceeds/);
 const final=await refunds.prepare(merchant,receiptId,"6","Complete return",randomUUID()),second="4".repeat(88);
 chain.receipts.set(second,transaction(chain.built[2]));await refunds.confirm(merchant,final.id,second);
 const [receipt]=await invoices.history(merchant,20,0);assert.equal(receipt.refundableAtomic,"0");assert.equal(receipt.refundedAtomic,"10000000");
 assert.equal((await invoices.summary(merchant)).revenueAtomic,"0");
});
test("two incoming payments are both recorded while duplicate refunds leave sales revenue unchanged",async()=>{
 const {merchant,invoices,refunds,chain,invoice,attempt,signature}=await setup(false);
 const otherPayer=signingWallet().address,secondAttempt=await invoices.prepare(invoice.id,otherPayer,undefined,randomUUID()),secondSignature="5".repeat(88);
 chain.receipts.set(secondSignature,transaction(chain.built[1]));
 await invoices.confirm(invoice.id,attempt.attemptId,signature);
 const duplicate=await invoices.confirm(invoice.id,secondAttempt.attemptId,secondSignature);assert.equal(duplicate.duplicate,true);
 const summary=await invoices.summary(merchant);assert.equal(summary.receivedAtomic,"20000000");assert.equal(summary.revenueAtomic,"10000000");assert.equal(summary.outstandingExcessAtomic,"10000000");
 const records=await invoices.history(merchant,20,0);assert.equal(records.length,2);assert.equal(records.filter(r=>r.kind==="duplicate").length,1);
 const refund=await refunds.prepare(merchant,duplicate.receiptId,"10","Duplicate payment",randomUUID()),refundSignature="6".repeat(88);
 assert.equal(refund.destination,otherPayer);chain.receipts.set(refundSignature,transaction(chain.built[2]));await refunds.confirm(merchant,refund.id,refundSignature);
 assert.equal((await invoices.summary(merchant)).revenueAtomic,"10000000");assert.equal((await invoices.summary(merchant)).outstandingExcessAtomic,"0");
});
test("overpayment refunds reduce excess before reducing invoice revenue",async()=>{
 const {merchant,refunds,receiptId,chain,invoices}=await setup(true,"12000000");
 assert.equal((await invoices.summary(merchant)).outstandingExcessAtomic,"2000000");
 const refund=await refunds.prepare(merchant,receiptId,"3","Return excess and one USDC",randomUUID()),signature="7".repeat(88);
 chain.receipts.set(signature,transaction(chain.built[1]));await refunds.confirm(merchant,refund.id,signature);
 const summary=await invoices.summary(merchant);assert.equal(summary.outstandingExcessAtomic,"0");assert.equal(summary.refundedInvoiceAtomic,"1000000");assert.equal(summary.revenueAtomic,"9000000");
});
test("concurrent refund requests reserve one pending request and preserve its budget",async()=>{
 const {merchant,refunds,receiptId}=await setup();
 const results=await Promise.allSettled([refunds.prepare(merchant,receiptId,"6","First",randomUUID()),refunds.prepare(merchant,receiptId,"6","Second",randomUUID())]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(results.filter(r=>r.status==="rejected").length,1);
 assert.equal((await db.query("SELECT id FROM refunds WHERE status='prepared'")).rows.length,1);
});
test("failed, wrong-recipient and over-sized refund receipts never become successful refunds",async()=>{
 const {merchant,refunds,receiptId,chain,invoices}=await setup();
 const refund=await refunds.prepare(merchant,receiptId,"4","Return",randomUUID()),signature="8".repeat(88);
 chain.receipts.set(signature,transaction({...chain.built[1],merchant:signingWallet().address}));await assert.rejects(refunds.confirm(merchant,refund.id,signature));
 chain.receipts.set(signature,transaction(chain.built[1],"5000000"));await assert.rejects(refunds.confirm(merchant,refund.id,signature),/approved amount/);
 const failed=transaction(chain.built[1]);failed.meta!.err={InstructionError:[0,"Custom"]} as never;chain.receipts.set(signature,failed);
 await assert.rejects(refunds.confirm(merchant,refund.id,signature),/failed/);assert.equal(await refunds.pending(merchant),null);
 assert.equal((await invoices.summary(merchant)).refundedInvoiceAtomic,"0");
});
test("uncertain submitted refunds cannot be replaced and old requests require reconciliation",async()=>{
 const {merchant,refunds,receiptId}=await setup();const refund=await refunds.prepare(merchant,receiptId,"4","Return",randomUUID());
 await assert.rejects(refunds.confirm(merchant,refund.id,"9".repeat(88)),/awaiting/);
 await assert.rejects(refunds.expire(merchant,refund.id),/uncertain/);
 await db.query("UPDATE refunds SET created_at=now()-interval '30 minutes' WHERE id=$1",[refund.id]);
 await assert.rejects(refunds.expire(merchant,refund.id),/older refund/);assert.equal((await refunds.pending(merchant))?.id,refund.id);
});
test("refund reconciliation recovers a finalized transfer after a lost browser callback",async()=>{
 const {merchant,refunds,receiptId,chain}=await setup();const refund=await refunds.prepare(merchant,receiptId,"4","Return",randomUUID()),signature="A".repeat(88);
 chain.receipts.set(signature,transaction(chain.built[1]));chain.findReceipts=async()=>[signature];
 assert.equal(await reconcileRefundsOnce(db,chain,refunds),1);assert.equal(await refunds.pending(merchant),null);
 assert.equal((await refunds.history(merchant,20,0))[0].signature,signature);
});
