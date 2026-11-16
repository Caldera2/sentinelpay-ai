# Safe integer-buffer compatibility

The root npm override routes `bigint-buffer` consumers to this private workspace. The abandoned package has no published fix for [CVE-2025-3194](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg).

This implementation provides its four conversion functions using JavaScript bigint and byte arrays. It has no native binding, install script, or dynamically loaded binary. Negative values, overflowing encodings, and oversized buffers are rejected. Valid unsigned encodings are checked against Node's native Buffer methods and Solana token-layout round trips in the regression suite.
