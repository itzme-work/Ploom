"""Real sing-box client/server loopback tests. Use only disposable credentials."""
import asyncio
import json
import secrets
import socket
import ssl
import struct
import subprocess
import sys
import tempfile
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

HOST = "127.0.0.1"


def port():
    with socket.socket() as sock:
        sock.bind((HOST, 0))
        return sock.getsockname()[1]


@asynccontextmanager
async def engine(binary, directory, name, inbound, outbound, route=None):
    file = directory / (name + ".json")
    config = {"log": {"disabled": True}, "inbounds": [inbound], "outbounds": [outbound]}
    if route is not None:
        config["route"] = route
    file.write_text(json.dumps(config))
    proc = await asyncio.create_subprocess_exec(binary, "run", "-c", file,
                                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(200):
            if inbound["type"] in ("hysteria2", "tuic"):
                with socket.socket(type=socket.SOCK_DGRAM) as udp:
                    try:
                        udp.bind((HOST, inbound["listen_port"]))
                    except OSError:
                        break
                await asyncio.sleep(.015)
                continue
            if proc.returncode is not None:
                raise RuntimeError(f"{name}: engine startup failed")
            try:
                _, writer = await asyncio.open_connection(inbound["listen"], inbound["listen_port"])
                writer.close()
                await writer.wait_closed()
                break
            except ConnectionRefusedError:
                await asyncio.sleep(.015)
        else:
            raise TimeoutError(name)
        yield
    finally:
        if proc.returncode is None:
            proc.terminate()
        await proc.wait()


async def transfer(binary, directory, target, proto, credentials, settings):
    endpoint = port()
    inbound = dict(type=proto, listen=HOST, listen_port=endpoint, **credentials[0], **settings[0])
    outbound = dict(type=proto, server=HOST, server_port=endpoint, **credentials[1], **settings[1])
    nonce = secrets.token_bytes(8192)
    async with engine(binary, directory, "provider", inbound, {"type": "direct"}):
        local = port()
        async with engine(binary, directory, "client", {"type": "socks", "listen": HOST,
                                                        "listen_port": local}, outbound):
            reader, writer = await asyncio.open_connection(HOST, local)
            try:
                writer.write(b"\x05\x01\x00")
                assert await reader.readexactly(2) == b"\x05\x00"
                writer.write(b"\x05\x01\x00\x01" + socket.inet_aton(HOST) + struct.pack("!H", target))
                assert (await reader.readexactly(4)) == b"\x05\x00\x00\x01"
                await reader.readexactly(6)
                writer.write(nonce)
                await writer.drain()
                assert await reader.readexactly(len(nonce)) == nonce
            finally:
                writer.close()
                await writer.wait_closed()


async def echo(reader, writer):
    try:
        while part := await reader.read(8192):
            writer.write(part)
            await writer.drain()
    finally:
        writer.close()


async def main(binary, directory):
    secret, uid = secrets.token_hex(24), str(uuid.uuid4())
    cert, key = directory / "cert.pem", directory / "key.pem"
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                    "-subj", "/CN=fixture.invalid", "-addext", "subjectAltName=DNS:fixture.invalid",
                    "-keyout", key, "-out", cert], stderr=subprocess.DEVNULL, check=True)
    server_tls = {"enabled": True, "certificate_path": str(cert), "key_path": str(key)}
    client_tls = {"enabled": True, "server_name": "fixture.invalid", "certificate_path": str(cert)}
    tls = ({"tls": server_tls}, {"tls": client_tls})
    user = {"username": "fixture", "password": secret}
    creds = ({"users": [user]}, user)
    suites = [
        ("http", creds, ({}, {})), ("http", creds, tls), ("socks", creds, ({}, {})),
        ("shadowsocks", ({"method": "aes-256-gcm", "password": secret},)*2, ({}, {})),
        ("trojan", ({"users": [{"password": secret}]}, {"password": secret}), tls),
        ("vmess", ({"users": [{"uuid": uid}]}, {"uuid": uid, "security": "auto"}), tls),
        ("vless", ({"users": [{"uuid": uid}]}, {"uuid": uid}), tls)]
    suites.extend([
        ("hysteria2", ({"users": [{"password": secret}]}, {"password": secret}), tls),
        ("tuic", ({"users": [{"uuid": uid, "password": secret}]}, {"uuid": uid, "password": secret}),
         ({"tls": dict(server_tls, alpn=["h3"])}, {"tls": dict(client_tls, alpn=["h3"])}))
    ])
    camouflage = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    camouflage.minimum_version = ssl.TLSVersion.TLSv1_3
    camouflage.load_cert_chain(cert, key)
    camouflage.set_alpn_protocols(["h2"])
    decoy = await asyncio.start_server(echo, HOST, 0, ssl=camouflage)
    pair = subprocess.check_output([binary, "generate", "reality-keypair"], text=True)
    keys = dict(line.split(": ", 1) for line in pair.strip().splitlines())
    short_id = secrets.token_hex(8)
    reality_server = {"enabled": True, "server_name": "fixture.invalid", "reality": {
        "enabled": True, "handshake": {"server": HOST, "server_port": decoy.sockets[0].getsockname()[1]},
        "private_key": keys["PrivateKey"], "short_id": [short_id]}}
    reality_client = {"enabled": True, "server_name": "fixture.invalid",
        "utls": {"enabled": True, "fingerprint": "chrome"},
        "reality": {"enabled": True, "public_key": keys["PublicKey"], "short_id": short_id}}
    vision = {"uuid": uid, "flow": "xtls-rprx-vision"}
    suites.append(("vless", ({"users": [vision]}, vision), ({"tls": reality_server}, {"tls": reality_client})))
    async with decoy, await asyncio.start_server(echo, HOST, 0) as target:
        for proto, credentials, settings in suites:
            await asyncio.wait_for(transfer(binary, directory, target.sockets[0].getsockname()[1],
                                            proto, credentials, settings), 12)
            print(proto, "REALITY/Vision" if "reality" in settings[0].get("tls", {}) else "TLS" if settings[0] else "TCP", "round trip OK", flush=True)


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as tmp:
        asyncio.run(main(Path(sys.argv[1]).resolve(), Path(tmp)))
