/* Author: Ethan. Descriptor-relative filesystem operations; no symlink following. */
#define _DARWIN_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#include <sys/stat.h>
#include <sys/file.h>
#include <fcntl.h>
#include <unistd.h>
#include <signal.h>
#include <limits.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#define LIMIT (1024*1024)
static size_t byte_limit=LIMIT;
static char fingerprint[65536];
static void fail(const char *s) { fprintf(stderr,"%s: %s\n",s,strerror(errno)); exit(1); }
static size_t parse_limit(const char *value) {
 if(!value||!*value){errno=EINVAL;fail("invalid byte limit");}
 size_t result=0;
 for(const unsigned char *p=(const unsigned char *)value;*p;p++){
  if(*p<'0'||*p>'9'){errno=EINVAL;fail("invalid byte limit");}
  size_t digit=(size_t)(*p-'0');
  if(result>(SIZE_MAX-digit)/10){errno=ERANGE;fail("invalid byte limit");}
  result=result*10+digit;
 }
 if(result==0||result>LIMIT){errno=EFBIG;fail("byte limit out of range");}
 return result;
}
static pid_t parse_pid(const char *value) {
 if(!value||!*value){errno=EINVAL;fail("invalid parent PID");}
 long result=0;
 for(const unsigned char *p=(const unsigned char *)value;*p;p++){
  if(*p<'0'||*p>'9'){errno=EINVAL;fail("invalid parent PID");}
  int digit=(int)(*p-'0');
  if(result>(LONG_MAX-digit)/10){errno=ERANGE;fail("invalid parent PID");}
  result=result*10+digit;
 }
 if(result<=0||result>INT_MAX){errno=EINVAL;fail("invalid parent PID");}
 return (pid_t)result;
}
static void reject_live_pid_marker(int fd) {
 char content[65];
 ssize_t n=pread(fd,content,sizeof(content),0);
 if(n<0)fail("read lock marker");
 if((size_t)n>=sizeof(content)){errno=EINVAL;fail("invalid existing lock marker");}
 content[n]='\0';
 char *start=content;
 int version2=!strncmp(start,"v2:",3);
 if(version2)start+=3;
 char *end=NULL;errno=0;
 long value=strtol(start,&end,10);
 if(errno||end==start||value<=0||value>INT_MAX){errno=EINVAL;fail("invalid existing lock marker");}
 while(*end==' '||*end=='\t'||*end=='\r'||*end=='\n')end++;
 if(*end!='\0'){errno=EINVAL;fail("invalid existing lock marker");}
 if(version2)return;
 if(kill((pid_t)value,0)==0||errno==EPERM){errno=EBUSY;fail("state lock PID is still alive");}
 if(errno!=ESRCH)fail("check state lock PID");
}
static void hold_state_lock(const char *value, pid_t parent) {
 if(parent!=getppid()){errno=EPERM;fail("parent PID mismatch");}
 if(value[0]!='/'||strlen(value)>4096){errno=EINVAL;fail("absolute lock path required");}
 char *path=strdup(value+1);if(!path)fail("lock path allocation");
 char *save=NULL,*part=strtok_r(path,"/",&save);
 int dir=open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(dir<0)fail("lock root");
 if(!part){errno=EINVAL;fail("lock filename required");}
 while(part){
  if(!strcmp(part,".")||!strcmp(part,"..")){errno=EPERM;fail("lock path traversal");}
  char *next=strtok_r(NULL,"/",&save);
  if(!next)break;
  int child=openat(dir,part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(child<0)fail("lock parent");
  close(dir);dir=child;part=next;
 }
 int fd=openat(dir,part,O_RDWR|O_CREAT|O_EXCL|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC,0600);
 int created=fd>=0;
 if(fd<0&&errno==EEXIST)fd=openat(dir,part,O_RDWR|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);
 if(fd<0)fail("open state lock");
 struct stat st;if(fstat(fd,&st)<0)fail("stat state lock");
 if(!S_ISREG(st.st_mode)||st.st_nlink!=1||st.st_uid!=geteuid()){errno=EPERM;fail("owned single-link lock file required");}
 if(fchmod(fd,0600)<0)fail("protect state lock");
 if(flock(fd,LOCK_EX|LOCK_NB)<0)fail("state directory is already locked");
 if(!created){
  if(st.st_size==0){errno=EINVAL;fail("existing state lock has no owner marker");}
  reject_live_pid_marker(fd);
 }
 if(ftruncate(fd,0)<0)fail("reset state lock marker");
 if(dprintf(fd,"v2:%ld\n",(long)parent)<0)fail("write state lock marker");
 if(fsync(fd)<0)fail("sync state lock marker");
 close(dir);free(path);
 if(printf("locked\n")<0||fflush(stdout)==EOF)fail("report state lock");
 char buffer[256];ssize_t n;
 do {n=read(STDIN_FILENO,buffer,sizeof(buffer));} while(n>0||(n<0&&errno==EINTR));
 if(n<0)fail("wait for state lock owner");
 close(fd);return;
}
static void stamp(int fd) {
 struct stat s; if(fstat(fd,&s)<0) fail("stat");
 size_t n=strlen(fingerprint);
#ifdef __APPLE__
 long mn=s.st_mtimespec.tv_nsec, cn=s.st_ctimespec.tv_nsec;
#else
 long mn=s.st_mtim.tv_nsec, cn=s.st_ctim.tv_nsec;
#endif
 int len=snprintf(fingerprint+n,sizeof(fingerprint)-n,"%llu:%llu:%llu:%lld:%lld:%ld:%lld:%ld;",(unsigned long long)s.st_dev,(unsigned long long)s.st_ino,(unsigned long long)(S_ISDIR(s.st_mode)?0:s.st_nlink),S_ISDIR(s.st_mode)?0:(long long)s.st_size,S_ISDIR(s.st_mode)?0:(long long)s.st_mtime,S_ISDIR(s.st_mode)?0:mn,S_ISDIR(s.st_mode)?0:(long long)s.st_ctime,S_ISDIR(s.st_mode)?0:cn);
 if(len<0||(size_t)len>=sizeof(fingerprint)-n) {errno=EOVERFLOW;fail("path");}
}
int main(int argc,char **argv) {
 if(argc>=2&&!strcmp(argv[1],"lock")){
  if(argc!=4){fprintf(stderr,"usage: safe-fs lock absolute-lock-path parent-pid\n");return 2;}
  hold_state_lock(argv[2],parse_pid(argv[3]));
  return 0;
 }
 int launching=argc>=2&&!strcmp(argv[1],"run-workspace");
 if(launching){
  if(argc<5||argv[4][0]!='/'){fprintf(stderr,"usage: safe-fs inspect|read|write|inspect-directory path fingerprint max-bytes; run-workspace path fingerprint executable [args]\n");return 2;}
 } else {
  if(argc!=5){fprintf(stderr,"usage: safe-fs inspect|read|write|inspect-directory path fingerprint max-bytes; run-workspace path fingerprint executable [args]\n");return 2;}
  if(strcmp(argv[1],"inspect")&&strcmp(argv[1],"read")&&strcmp(argv[1],"write")&&strcmp(argv[1],"inspect-directory")){errno=EINVAL;fail("unknown operation");}
  byte_limit=parse_limit(argv[4]);
 }
 int directory=!strcmp(argv[1],"inspect-directory")||launching;
 if(argv[2][0]!='/'||strlen(argv[2])>4096) {errno=EINVAL;fail("absolute path required");}
 char *path=strdup(argv[2]+1);if(!path)fail("path allocation");
 char *save=NULL, *part=strtok_r(path,"/",&save);
 int dir=open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(dir<0)fail("root"); stamp(dir);
 if(!part&&!directory){errno=EINVAL;fail("file required");}
 while(part){
  if(!strcmp(part,".")||!strcmp(part,"..")){errno=EPERM;fail("traversal");}
  char *next=strtok_r(NULL,"/",&save); if(!next&&!directory)break;
  int child=openat(dir,part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(child<0)fail("parent");close(dir);dir=child;stamp(dir);part=next;
 }
 if(directory){
  if(!launching){puts(fingerprint);return 0;}
  if(strcmp(argv[3],fingerprint)){errno=ESTALE;fail("workspace changed since authorization");}
  if(fchdir(dir)<0)fail("workspace cwd");
  close(dir);free(path);
  execv(argv[4],argv+4);fail("execute");
 }
 int writing=!strcmp(argv[1],"write"), inspecting=!strcmp(argv[1],"inspect");
 int fd=openat(dir,part,(writing?O_WRONLY:O_RDONLY)|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);
 int missing=fd<0&&errno==ENOENT;
 if(fd<0&&!missing)fail("open");
 if(missing){size_t used=strlen(fingerprint), marker_size=sizeof("missing;");if(used>sizeof(fingerprint)-marker_size){errno=ENAMETOOLONG;fail("fingerprint limit");}memcpy(fingerprint+used,"missing;",marker_size);}
 else {struct stat s;if(fstat(fd,&s)<0)fail("stat");if(!S_ISREG(s.st_mode)||s.st_nlink!=1){errno=EPERM;fail("single-link regular file required");}stamp(fd);}
 if(inspecting){puts(fingerprint);return 0;}
 if(strcmp(argv[3],fingerprint)){errno=ESTALE;fail("resource changed since authorization");}
 if(writing){
  unsigned char *buf=malloc(byte_limit+1); if(!buf)fail("memory");size_t size=0;ssize_t n;
  while((n=read(STDIN_FILENO,buf+size,byte_limit+1-size))>0){size+=(size_t)n;if(size>byte_limit){errno=EFBIG;fail("write limit");}}
  if(n<0)fail("input");
  if(missing){fd=openat(dir,part,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);if(fd<0)fail("exclusive create");}
  else if(ftruncate(fd,0)<0)fail("truncate");
  for(size_t offset=0;offset<size;){n=write(fd,buf+offset,size-offset);if(n<=0)fail("write");offset+=(size_t)n;}
  if(fsync(fd)<0)fail("sync");printf("%zu\n",size);
 } else {
  if(missing){errno=ENOENT;fail("read");}
  unsigned char *buf=malloc(byte_limit+1);if(!buf)fail("memory");size_t total=0;ssize_t n;
  while((n=read(fd,buf+total,byte_limit+1-total))>0){total+=(size_t)n;if(total>byte_limit){errno=EFBIG;fail("read limit");}}
  if(n<0)fail("read");
  for(size_t offset=0;offset<total;){n=write(STDOUT_FILENO,buf+offset,total-offset);if(n<=0)fail("output");offset+=(size_t)n;}
 }
 close(fd);close(dir);free(path);return 0;
}
