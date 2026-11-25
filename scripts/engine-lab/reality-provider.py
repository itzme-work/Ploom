"""Disposable VLESS REALITY/Vision provider for installed-client tests."""
import asyncio
import json
import secrets
import ssl
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

from protocols import HOST, echo, engine, port


async def main(binary, provider_host, directory):
    cert, key = directory / "cert.pem", directory / "key.pem"
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                    "-subj", "/CN=fixture.invalid", "-keyout", key, "-out", cert],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.minimum_version = ssl.TLSVersion.TLSv1_3
    tls.set_alpn_protocols(["h2"])
    tls.load_cert_chain(cert, key)
    token = secrets.token_hex(24)

    async def target(reader, writer):
        try:
            request = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 5)
            if request.startswith(f"GET /{token} HTTP/".encode()):
                writer.write(f"HTTP/1.1 200 OK\r\nContent-Length: {len(token)}\r\nConnection: close\r\n\r\n{token}".encode())
                await writer.drain()
        finally:
            writer.close()

    async with await asyncio.start_server(echo, HOST, 0, ssl=tls) as handshake, await asyncio.start_server(target, HOST, 0) as http:
        pair = subprocess.check_output([binary, "generate", "reality-keypair"], text=True)
        keys = dict(line.split(": ", 1) for line in pair.strip().splitlines())
        uid, sid, endpoint = uuid.uuid4(), secrets.token_hex(8), port()
        flow = "xtls-rprx-vision"
        inbound = {"type": "vless", "listen": provider_host, "listen_port": endpoint,
                   "users": [{"uuid": str(uid), "flow": flow}], "tls": {"enabled": True,
                   "server_name": "fixture.invalid", "reality": {"enabled": True,
                   "handshake": {"server": HOST, "server_port": handshake.sockets[0].getsockname()[1]},
                   "private_key": keys["PrivateKey"], "short_id": [sid]}}}
        async with engine(binary, directory, "reality-provider", inbound, {"type": "direct"}):
            uri = (f"vless://{uid}@{provider_host}:{endpoint}?security=reality&sni=fixture.invalid"
                   f"&fp=chrome&pbk={keys['PublicKey']}&sid={sid}&flow={flow}#Reality-fixture")
            print(json.dumps({"uri": uri, "port": http.sockets[0].getsockname()[1], "token": token}), flush=True)
            await asyncio.to_thread(sys.stdin.buffer.read, 1)


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as tmp:
        asyncio.run(main(Path(sys.argv[1]).resolve(), sys.argv[2], Path(tmp)))
