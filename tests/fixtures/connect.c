/* Author: Ethan. Real socket probe used only by the adversarial E2E suite. */
#include <arpa/inet.h>
#include <sys/socket.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(int argc, char **argv) {
 if(argc!=2) return 2;
 int fd=socket(AF_INET,SOCK_STREAM,0); if(fd<0){perror("socket");return 8;}
 struct sockaddr_in address;memset(&address,0,sizeof(address));address.sin_family=AF_INET;address.sin_port=htons((unsigned short)atoi(argv[1]));inet_pton(AF_INET,"127.0.0.1",&address.sin_addr);
 if(connect(fd,(struct sockaddr*)&address,sizeof(address))<0){perror("connect");return 9;}
 const char *request="GET / HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n";
 if(write(fd,request,strlen(request))<0)return 10;
 char buffer[1024];while(read(fd,buffer,sizeof(buffer))>0){}close(fd);return 0;
}
