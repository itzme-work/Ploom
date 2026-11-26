// Test runner only. Exchange one challenge with the synthetic destinations through Android's default route.
#include <arpa/inet.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

int main(int argc, char **argv) {
    if (argc != 4) return 2;
    int udp = strcmp(argv[1], "http") != 0;
    int v6 = strcmp(argv[1], "udp6") == 0;
    if (udp && !v6 && strcmp(argv[1], "udp4") != 0) return 2;
    int port = atoi(argv[2]);
    size_t length = strlen(argv[3]);
    if (port < 1 || port > 65535 || length == 0 || length > 256 ||
        strspn(argv[3], "0123456789abcdef") != length || length % 2) return 2;
    int fd = socket(v6 ? AF_INET6 : AF_INET, udp ? SOCK_DGRAM : SOCK_STREAM, 0);
    if (fd < 0) { perror("socket"); return 1; }
    struct timeval timeout = {.tv_sec = 8};
    if (setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&timeout,sizeof(timeout)) ||
        setsockopt(fd,SOL_SOCKET,SO_SNDTIMEO,&timeout,sizeof(timeout))) { perror("timeout"); return 1; }
    struct sockaddr_in addr4 = {.sin_family = AF_INET, .sin_port = htons(port)};
    struct sockaddr_in6 addr6 = {.sin6_family = AF_INET6, .sin6_port = htons(port)};
    inet_pton(AF_INET, udp ? "192.0.2.53" : "192.0.2.90", &addr4.sin_addr);
    inet_pton(AF_INET6,"2001:db8::53",&addr6.sin6_addr);
    if (connect(fd, v6 ? (struct sockaddr *)&addr6 : (struct sockaddr *)&addr4,
                v6 ? sizeof(addr6) : sizeof(addr4))) { perror("connect"); return 1; }
    unsigned char buf[4096];
    int size;
    if (udp) {
        size = (int)(length/2);
        for (int i=0; i<size; i++) sscanf(argv[3]+2*i,"%2hhx",&buf[i]);
    } else {
        size = snprintf((char *)buf,sizeof(buf),"GET /%s HTTP/1.0\r\nHost: fixture.invalid\r\n\r\n",argv[3]);
    }
    if (send(fd,buf,size,0) != size) { perror("send"); return 1; }
    do {
        ssize_t count = recv(fd,buf,sizeof(buf),0);
        if (count < 0) { perror("receive"); return 1; }
        if (count == 0) break;
        if (udp) {
            for (ssize_t i=0;i<count;i++) printf("%02x",buf[i]);
        } else if (fwrite(buf,1,(size_t)count,stdout) != (size_t)count) return 1;
    } while (!udp);
    return close(fd) != 0;
}
