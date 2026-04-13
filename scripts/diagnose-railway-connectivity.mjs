import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const host = "backboard.railway.com";
const targetPath = "/graphql/v2";
const proxyCandidates = [
  process.env.HTTPS_PROXY,
  process.env.HTTP_PROXY,
  process.env.ALL_PROXY,
  process.env.RAILWAY_PROXY_URL
].filter(Boolean);

function logSection(title, data) {
  console.log(`\n=== ${title} ===`);
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

async function testDns() {
  const records = await dns.lookup(host, { all: true });
  logSection("DNS Lookup", records);
}

async function testTcp(port) {
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host, port, timeout: 8_000 }, () => {
      logSection(`TCP ${port}`, "connected");
      socket.end();
      resolve();
    });

    socket.on("error", reject);
    socket.on("timeout", () => reject(new Error(`TCP ${port} timeout`)));
  });
}

async function testTls() {
  await new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host,
        port: 443,
        servername: host,
        timeout: 8_000
      },
      () => {
        logSection("TLS Handshake", {
          authorized: socket.authorized,
          authorizationError: socket.authorizationError ?? null,
          alpnProtocol: socket.alpnProtocol || null
        });
        socket.end();
        resolve();
      }
    );

    socket.on("error", reject);
    socket.on("timeout", () => reject(new Error("TLS handshake timeout")));
  });
}

async function testHttps(payloadBytes) {
  const payload = JSON.stringify({
    query: "{ __typename }",
    padding: "x".repeat(Math.max(0, payloadBytes - 32))
  });

  await new Promise((resolve, reject) => {
    const request = https.request(
      {
        host,
        port: 443,
        path: targetPath,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        },
        timeout: 10_000
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          logSection(`HTTPS POST (${payloadBytes} bytes)`, {
            statusCode: response.statusCode,
            contentType: response.headers["content-type"] ?? null,
            sample: body.slice(0, 200)
          });
          resolve();
        });
      }
    );

    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("HTTPS request timeout")));
    request.write(payload);
    request.end();
  });
}

async function testProxy(proxyUrl) {
  logSection("Proxy Candidate", proxyUrl);
  try {
    const result = await fetch(`https://${host}${targetPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ __typename }" }),
      dispatcher: undefined
    });

    logSection(`Proxy Result ${proxyUrl}`, {
      status: result.status,
      contentType: result.headers.get("content-type"),
      sample: (await result.text()).slice(0, 200)
    });
  } catch (error) {
    logSection(`Proxy Error ${proxyUrl}`, String(error));
  }
}

async function testPingMtu(size) {
  try {
    const { stdout, stderr } = await execFileAsync("ping", ["-f", "-l", String(size), host, "-n", "1"], {
      windowsHide: true
    });
    logSection(`Ping MTU ${size}`, stdout || stderr);
  } catch (error) {
    const output = error.stdout || error.stderr || String(error);
    logSection(`Ping MTU ${size}`, output);
  }
}

async function main() {
  logSection("Environment", {
    node: process.version,
    proxies: proxyCandidates,
    platform: process.platform
  });

  await testDns();
  await testTcp(443);
  await testTls();

  for (const size of [256, 1024, 1400, 1472]) {
    await testHttps(size);
  }

  for (const proxyUrl of proxyCandidates) {
    await testProxy(proxyUrl);
  }

  for (const packetSize of [1200, 1400, 1472]) {
    await testPingMtu(packetSize);
  }
}

main().catch((error) => {
  console.error("\n=== Railway Connectivity Diagnostic Failed ===");
  console.error(error);
  process.exitCode = 1;
});
