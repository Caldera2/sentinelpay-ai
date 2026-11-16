import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { toBigIntBE, toBigIntLE, toBufferBE, toBufferLE } from "@sentinelpay/bigint-codec";
import { u64, u128 } from "@solana/buffer-layout-utils";

test("safe integer codec matches native Buffer uint64 encodings and Solana layouts",()=>{
  for(let index=0;index<200;index++){
    const bytes=randomBytes(8),value=bytes.readBigUInt64LE();
    assert.equal(toBigIntLE(bytes),value);assert.equal(toBigIntBE(bytes),bytes.readBigUInt64BE());
    assert.deepEqual(toBufferLE(value,8),bytes);
    const big=Buffer.alloc(8);big.writeBigUInt64BE(value);assert.deepEqual(toBufferBE(value,8),big);
    const layout=u64();assert.equal(layout.decode(bytes),value);const encoded=Buffer.alloc(8);layout.encode(value,encoded,0);assert.deepEqual(encoded,bytes);
  }
  const wide=(1n<<128n)-1n,bytes=Buffer.alloc(16);u128().encode(wide,bytes,0);assert.equal(u128().decode(bytes),wide);
  assert.equal(toBigIntLE(Buffer.alloc(0)),0n);assert.deepEqual(toBufferBE(0n,0),Buffer.alloc(0));
});
test("safe integer codec rejects negative, overflowing and oversized conversions",()=>{
  assert.throws(()=>toBufferLE(-1n,8),RangeError);assert.throws(()=>toBufferBE(1n<<64n,8),RangeError);
  assert.throws(()=>toBufferLE(1n,0),RangeError);assert.throws(()=>toBufferBE(0n,-1),RangeError);
  assert.throws(()=>toBufferLE(0n,Infinity),RangeError);assert.throws(()=>toBufferLE(0n,4097),RangeError);
  assert.throws(()=>toBigIntLE(Buffer.alloc(4097)),RangeError);
  assert.equal(require("bigint-buffer").toBigIntLE,toBigIntLE);
});
