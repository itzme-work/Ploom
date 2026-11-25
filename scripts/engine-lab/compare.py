"""Compare three verified Linux engines against one loopback-only CONNECT fixture."""
import argparse
import asyncio
import json
import os
import socket
import struct
import tempfile
import time
from pathlib import Path

HOST = "127.0.0.1"
SIZE = 4 * 1024 * 1024


def config(name, local, upstream):
    if name == "sing-box":
        return {"inbounds": [{"type": "socks", "listen": HOST, "listen_port": local}],
                "outbounds": [{"type": "http", "server": HOST, "server_port": upstream}]}
    if name == "xray":
        return {"inbounds": [{"listen": HOST, "port": local, "protocol": "socks"}],
                "outbounds": [{"protocol": "http", "settings": {
                    "servers": [{"address": HOST, "port": upstream}]}}]}
    return {"socks-port": local, "allow-lan": False, "mode": "rule",
            "proxies": [{"name": "fixture", "type": "http", "server": HOST, "port": upstream}],
            "rules": ["MATCH,fixture"]}


async def trial(binary, upstream, port, payload):
    with socket.socket() as probe:
        probe.bind((HOST, 0))
        local = probe.getsockname()[1]
    with tempfile.TemporaryDirectory() as tmp:
        filename = Path(tmp, "config.json")
        filename.write_text(json.dumps(config(binary.name, local, upstream)))
        args = {"sing-box": ["run", "-c"], "xray": ["run", "-c"], "mihomo": ["-d", tmp, "-f"]}
        start = time.monotonic()
        proc = await asyncio.create_subprocess_exec(binary, *args[binary.name], filename, cwd=tmp,
                                                    stdout=asyncio.subprocess.DEVNULL)
        try:
            # Mihomo opens its inbound before activating its initial rule provider.
            # Use identical warm-up for all engines; report it as part of startup.
            await asyncio.sleep(.25)
            while True:
                if proc.returncode is not None:
                    raise RuntimeError(f"{binary.name} exited: {proc.returncode}")
                try:
                    reader, writer = await asyncio.open_connection(HOST, local)
                    break
                except ConnectionRefusedError:
                    await asyncio.sleep(.005)
            try:
                writer.write(b"\x05\x01\x00")
                assert await reader.readexactly(2) == b"\x05\x00"
                writer.write(b"\x05\x01\x00\x01" + socket.inet_aton("192.0.2.1") + struct.pack("!H", port))
                result = await reader.readexactly(4)
                assert result[:2] == b"\x05\x00"
                await reader.readexactly({1: 4, 4: 16}[result[3]] + 2)
                writer.write(b"GET /fixture HTTP/1.0\r\n\r\n")
                begin = time.monotonic()
                assert await reader.readuntil(b"\r\n\r\n") == f"HTTP/1.0 200 OK\r\nContent-Length: {SIZE}\r\n\r\n".encode()
                assert await reader.readexactly(SIZE) == payload
                end = time.monotonic()
                status = Path(f"/proc/{proc.pid}/status").read_text()
                rss = int(next(line.split()[1] for line in status.splitlines() if line.startswith("VmHWM:")))
                stat = Path(f"/proc/{proc.pid}/stat").read_text().rsplit(")", 1)[1].split()
                print(json.dumps(dict(engine=binary.name, startup_ms=round((begin-start)*1000, 1),
                                      MiB_sec=round(SIZE/(end-begin)/2**20, 1), peak_KiB=rss,
                                      cpu_seconds=(int(stat[11])+int(stat[12]))/os.sysconf("SC_CLK_TCK"),
                                      executable_bytes=binary.stat().st_size)))
            finally:
                writer.close()
                await writer.wait_closed()
        finally:
            if proc.returncode is None:
                proc.kill()
            await proc.wait()


async def main(directory):
    payload = os.urandom(SIZE)
    served = 0

    async def origin(reader, writer):
        await reader.readuntil(b"\r\n\r\n")
        writer.write(f"HTTP/1.0 200 OK\r\nContent-Length: {SIZE}\r\n\r\n".encode() + payload)
        await writer.drain()
        writer.close()

    async with await asyncio.start_server(origin, HOST, 0) as server:
        port = server.sockets[0].getsockname()[1]

        async def proxy(reader, writer):
            nonlocal served
            header = await reader.readuntil(b"\r\n\r\n")
            if header.splitlines()[0].split()[:2] != [b"CONNECT", f"192.0.2.1:{port}".encode()]:
                writer.close()
                return
            upstream, outbound = await asyncio.open_connection(HOST, port)
            writer.write(b"HTTP/1.1 200 OK\r\n\r\n")
            outbound.write(await reader.readuntil(b"\r\n\r\n"))
            while chunk := await upstream.read(65536):
                writer.write(chunk)
                await writer.drain()
            served += 1
            outbound.close()
            writer.close()

        async with await asyncio.start_server(proxy, HOST, 0) as upstream:
            for name in ("sing-box", "xray", "mihomo"):
                await asyncio.wait_for(trial(directory / name, upstream.sockets[0].getsockname()[1],
                                             port, payload), 20)
        assert served == 3


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    asyncio.run(main(parser.parse_args().directory.resolve()))
