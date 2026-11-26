"""Verify DNS wire data inside a SOCKS5 UDP relay through a Shadowsocks provider."""
import asyncio
import secrets
import socket
import struct
import sys
import tempfile
from pathlib import Path
from protocols import HOST, engine, port


async def dns_relay(binary, directory, family):
    loop = asyncio.get_running_loop()
    host = "::1" if family == socket.AF_INET6 else HOST
    with socket.socket(family, socket.SOCK_DGRAM) as dns, socket.socket(type=socket.SOCK_DGRAM) as client:
        dns.bind((host, 0))
        dns.setblocking(False)
        client.setblocking(False)
        provider, local = port(), port()
        common = {"type": "shadowsocks", "method": "aes-256-gcm", "password": secrets.token_hex(16)}
        async with engine(binary, directory, "provider", dict(common, listen=HOST, listen_port=provider),
                          {"type": "direct"}), engine(binary, directory, "client",
                          {"type": "socks", "listen": HOST, "listen_port": local},
                          dict(common, server=HOST, server_port=provider)):
            reader, writer = await asyncio.open_connection(HOST, local)
            try:
                writer.write(b"\x05\x01\x00")
                assert await reader.readexactly(2) == b"\x05\x00"
                writer.write(b"\x05\x03\x00\x01" + bytes(6))
                assert await reader.readexactly(4) == b"\x05\x00\x00\x01"
                addr = socket.inet_ntoa(await reader.readexactly(4))
                relay_port, = struct.unpack("!H", await reader.readexactly(2))
                question = b"\x07fixture\x07invalid\x00\x00\x01\x00\x01"
                tx = secrets.token_bytes(2)
                query = tx + bytes.fromhex("01000001000000000000") + question
                answer = tx + bytes.fromhex("81800001000100000000") + question
                answer += bytes.fromhex("c00c000100010000003c0004c0000201")
                envelope = bytes([0, 0, 0, 4 if family == socket.AF_INET6 else 1])
                envelope += socket.inet_pton(family, host) + struct.pack("!H", dns.getsockname()[1])
                await loop.sock_sendto(client, envelope + query, (addr, relay_port))
                data, peer = await loop.sock_recvfrom(dns, 4096)
                assert data == query
                await loop.sock_sendto(dns, answer, peer)
                response, _ = await loop.sock_recvfrom(client, 4096)
                assert response.endswith(answer)
            finally:
                writer.close()
                await writer.wait_closed()


async def main(binary, directory):
    for family in [socket.AF_INET, socket.AF_INET6]:
        await asyncio.wait_for(dns_relay(binary, directory, family), 8)
        print(f"DNS query/answer over UDP through Shadowsocks ({family.name} destination): OK")


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as tmp:
        asyncio.run(main(Path(sys.argv[1]).resolve(), Path(tmp)))
