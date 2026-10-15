// Server-only file scanner (§34, DOC-04).
// Tries ClamAV INSTREAM (TCP, no extra dependency) when bytes are provided;
// falls back to the name-gate (EICAR marker + spoofed executable types) when
// no daemon answers or no bytes were sent. Every verdict names its engine so
// the UI never implies a real scan that did not happen.
// Import ONLY in API routes / server code.
import net from "node:net";
import { scanFile as nameGate } from "./rules";

const CHUNK = 8192;

function instream(buf, { host, port, timeoutMs }) {
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch {}
      resolve(result);
    };
    const timer = setTimeout(() => done({ ok: false, code: "SCAN_TIMEOUT" }), timeoutMs);
    const sock = net.createConnection({ host, port }, () => {
      sock.write(Buffer.from("zINSTREAM\0", "ascii"));
      for (let off = 0; off < buf.length; off += CHUNK) {
        const part = buf.subarray(off, off + CHUNK);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length, 0);
        sock.write(Buffer.concat([len, part]));
      }
      sock.write(Buffer.alloc(4)); // zero-length chunk = end of stream
    });
    sock.on("data", (d) => {
      out += d.toString("utf8");
      if (/FOUND/.test(out)) {
        const sig = (out.match(/stream:\s*(.+?)\s+FOUND/i) || [])[1] || "malware";
        done({ ok: true, infected: true, signature: sig, engine: "clamav" });
      }
    });
    const finish = () => {
      if (/OK\s*$/.test(out.trim())) done({ ok: true, infected: false, engine: "clamav" });
      else done({ ok: false, code: "SCAN_UNAVAILABLE", raw: out.slice(0, 200) });
    };
    sock.on("end", finish);
    sock.on("close", finish);
    sock.on("error", () => done({ ok: false, code: "SCAN_UNAVAILABLE" }));
  });
}

// scanUpload({ name, mime, bytes, clamav }) →
// { infected, engine: "clamav"|"name-gate", fallback?, signature? }
// (throws {code} to reject). engine is always truthful: "clamav" only when a
// daemon actually returned a verdict; otherwise the name-gate decides and
// `fallback: true` notes bytes went unscanned by ClamAV.
export async function scanUpload({ name = "", mime = "", bytes = null, clamav = null } = {}) {
  let attempted = false;
  if (bytes && clamav?.host) {
    attempted = true;
    const r = await instream(Buffer.from(bytes), {
      host: clamav.host,
      port: clamav.port || 3310,
      timeoutMs: clamav.timeoutMs || 20000,
    });
    if (r.ok) return { infected: !!r.infected, engine: "clamav", signature: r.signature || null };
    // Daemon unreachable/timed out — fall through to the name-gate so the
    // upload is still gated instead of failing open.
  }
  try {
    nameGate(String(name), String(mime));
  } catch (e) {
    return { infected: true, engine: "name-gate", fallback: attempted, signature: e.code || "FILE_INFECTED" };
  }
  // Bytes present but no daemon verdict: still sniff content for the standard
  // EICAR test signature so a renamed payload cannot slip through.
  if (bytes) {
    const text = Buffer.from(bytes).toString("latin1");
    if (/EICAR-STANDARD-ANTIVIRUS-TEST-FILE/i.test(text)) {
      return { infected: true, engine: "name-gate", fallback: attempted, signature: "EICAR-Test-File" };
    }
  }
  return { infected: false, engine: "name-gate", fallback: attempted };
}
