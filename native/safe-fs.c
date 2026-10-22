/* Author: Ethan. Descriptor-relative filesystem operations; no symlink following. */
#define _DARWIN_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#define LIMIT (1024*1024)
static char fingerprint[65536];
static void fail(const char *s) { fprintf(stderr,"%s: %s\n",s,strerror(errno)); exit(1); }
static void stamp(int fd) {
 struct stat s; if(fstat(fd,&s)<0) fail("stat");
 size_t n=strlen(fingerprint);
#ifdef __APPLE__
 long mn=s.st_mtimespec.tv_nsec, cn=s.st_ctimespec.tv_nsec;
#else
 long mn=s.st_mtim.tv_nsec, cn=s.st_ctim.tv_nsec;
#endif
 int len=snprintf(fingerprint+n,sizeof(fingerprint)-n,"%llu:%llu:%llu:%lld:%lld:%ld:%lld:%ld;",(unsigned long long)s.st_dev,(unsigned long long)s.st_ino,(unsigned long long)s.st_nlink,S_ISDIR(s.st_mode)?0:(long long)s.st_size,S_ISDIR(s.st_mode)?0:(long long)s.st_mtime,S_ISDIR(s.st_mode)?0:mn,S_ISDIR(s.st_mode)?0:(long long)s.st_ctime,S_ISDIR(s.st_mode)?0:cn);
 if(len<0||(size_t)len>=sizeof(fingerprint)-n) {errno=EOVERFLOW;fail("path");}
}
int main(int argc,char **argv) {
 if(argc!=5) {fprintf(stderr,"usage: safe-fs inspect|read|write absolute-path expected-fingerprint max-bytes\n");return 2;}
 if(argv[2][0]!='/'||strlen(argv[2])>4096) {errno=EINVAL;fail("absolute path required");}
 char *path=strdup(argv[2]+1), *save=NULL, *part=strtok_r(path,"/",&save);
 int dir=open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(dir<0)fail("root"); stamp(dir);
 if(!part){errno=EINVAL;fail("file required");}
 while(1){
  if(!strcmp(part,".")||!strcmp(part,"..")){errno=EPERM;fail("traversal");}
  char *next=strtok_r(NULL,"/",&save); if(!next)break;
  int child=openat(dir,part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(child<0)fail("parent");close(dir);dir=child;stamp(dir);part=next;
 }
 int writing=!strcmp(argv[1],"write"), inspecting=!strcmp(argv[1],"inspect");
 int fd=openat(dir,part,(writing?O_WRONLY:O_RDONLY)|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);
 int missing=fd<0&&errno==ENOENT;
 if(fd<0&&!missing)fail("open");
 if(missing)strcat(fingerprint,"missing;");
 else {struct stat s;if(fstat(fd,&s)<0)fail("stat");if(!S_ISREG(s.st_mode)||s.st_nlink!=1){errno=EPERM;fail("regular unlinked-alias-free file required");}stamp(fd);}
 if(inspecting){puts(fingerprint);return 0;}
 if(strcmp(argv[3],fingerprint)){errno=ESTALE;fail("resource changed since authorization");}
 if(writing){
  unsigned char *buf=malloc(LIMIT+1); if(!buf)fail("memory");size_t size=0;ssize_t n;
  while((n=read(STDIN_FILENO,buf+size,LIMIT+1-size))>0){size+=(size_t)n;if(size>LIMIT){errno=EFBIG;fail("write limit");}}
  if(n<0)fail("input");
  if(missing){fd=openat(dir,part,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);if(fd<0)fail("exclusive create");}
  else if(ftruncate(fd,0)<0)fail("truncate");
  for(size_t offset=0;offset<size;){n=write(fd,buf+offset,size-offset);if(n<=0)fail("write");offset+=(size_t)n;}
  if(fsync(fd)<0)fail("sync");printf("%zu\n",size);
 } else {
  if(missing){errno=ENOENT;fail("read");}
  unsigned char buf[8192];size_t total=0;ssize_t n;
  while((n=read(fd,buf,sizeof(buf)))>0){total+=(size_t)n;if(total>LIMIT){errno=EFBIG;fail("read limit");}size_t o=0;while(o<(size_t)n){ssize_t w=write(STDOUT_FILENO,buf+o,(size_t)n-o);if(w<=0)fail("output");o+=(size_t)w;}}
  if(n<0)fail("read");
 }
 close(fd);close(dir);free(path);return 0;
}
