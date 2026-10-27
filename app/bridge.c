/* Node-API: private Unix descriptors and GTK textures. No page APIs. */
#include <node_api.h>
#include <gtk/gtk.h>
#include <sys/socket.h>
#include <sys/mman.h>
#include <unistd.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>
#define FRAME_BYTES (64*1024*1024)
static napi_threadsafe_function releases;
static napi_value fail(napi_env e,const char *s){napi_throw_error(e,NULL,s);return NULL;}
static int integer(napi_env e,napi_value v){int32_t n=-1;napi_get_value_int32(e,v,&n);return n;}
static int prop(napi_env e,napi_value v,const char *s){napi_value x;napi_get_named_property(e,v,s,&x);return integer(e,x);}
static napi_value number(napi_env e,int n){napi_value v;napi_create_int32(e,n,&v);return v;}
static napi_value channels(napi_env e,napi_callback_info ci){
 (void)ci;int a[2],b[2];if(socketpair(AF_UNIX,SOCK_STREAM|SOCK_CLOEXEC,0,a))return fail(e,strerror(errno));
 if(socketpair(AF_UNIX,SOCK_SEQPACKET|SOCK_CLOEXEC|SOCK_NONBLOCK,0,b)){close(a[0]);close(a[1]);return fail(e,strerror(errno));}
 int m=memfd_create("amzml-node-frames",MFD_CLOEXEC);
 if(m<0||ftruncate(m,FRAME_BYTES*3L)){close(a[0]);close(a[1]);close(b[0]);close(b[1]);if(m>=0)close(m);return fail(e,strerror(errno));}
 napi_value result;napi_create_array_with_length(e,5,&result);int fds[]={a[0],a[1],m,b[0],b[1]};
 for(int i=0;i<5;i++)napi_set_element(e,result,i,number(e,fds[i]));return result;
}
static napi_value receive_texture(napi_env e,napi_callback_info ci){
 size_t n=1;napi_value v;napi_get_cb_info(e,ci,&n,&v,NULL,NULL);int fd=integer(e,v),fds[8],count=0;
 char body[8192];union{struct cmsghdr align;char data[CMSG_SPACE(sizeof(fds))];}control={0};
 struct iovec io={body,sizeof(body)};struct msghdr msg={.msg_iov=&io,.msg_iovlen=1,.msg_control=control.data,.msg_controllen=sizeof(control.data)};
 ssize_t size=recvmsg(fd,&msg,MSG_DONTWAIT|MSG_CMSG_CLOEXEC);
 if(size<0&&(errno==EAGAIN||errno==EWOULDBLOCK)){napi_get_null(e,&v);return v;}
 for(struct cmsghdr*c=CMSG_FIRSTHDR(&msg);c;c=CMSG_NXTHDR(&msg,c))if(c->cmsg_level==SOL_SOCKET&&c->cmsg_type==SCM_RIGHTS){
  int k=(c->cmsg_len-CMSG_LEN(0))/sizeof(int);if(k>8-count)k=8-count;memcpy(fds+count,CMSG_DATA(c),k*sizeof(int));count+=k;
 }
 if(size<=0||(msg.msg_flags&(MSG_TRUNC|MSG_CTRUNC))||count<1||count>4){for(int i=0;i<count;i++)close(fds[i]);return fail(e,"Invalid texture packet");}
 napi_value out,bytes,list;napi_create_array_with_length(e,2,&out);napi_create_buffer_copy(e,size,body,NULL,&bytes);napi_create_array_with_length(e,count,&list);
 for(int i=0;i<count;i++)napi_set_element(e,list,i,number(e,fds[i]));napi_set_element(e,out,0,bytes);napi_set_element(e,out,1,list);return out;
}
static void release_js(napi_env e,napi_value cb,void*context,void*data){
 (void)context;uint64_t *sequence=data;if(e&&cb){napi_value arg,global;napi_create_double(e,(double)*sequence,&arg);napi_get_global(e,&global);napi_call_function(e,global,cb,1,&arg,NULL);}free(sequence);
}
static napi_value on_release(napi_env e,napi_callback_info ci){
 size_t n=1;napi_value cb,name;napi_get_cb_info(e,ci,&n,&cb,NULL,NULL);napi_create_string_utf8(e,"GTK texture release",NAPI_AUTO_LENGTH,&name);
 if(releases)return fail(e,"Release callback already installed");
 napi_create_threadsafe_function(e,cb,NULL,name,0,1,NULL,NULL,NULL,release_js,&releases);napi_unref_threadsafe_function(e,releases);return number(e,0);
}
typedef struct{int fds[4],count;uint64_t sequence;}Lease;
static void destroy_lease(gpointer data){
 Lease *l=data;for(int i=0;i<l->count;i++)close(l->fds[i]);uint64_t *sequence=malloc(sizeof(*sequence));*sequence=l->sequence;
 if(napi_call_threadsafe_function(releases,sequence,napi_tsfn_nonblocking)!=napi_ok)free(sequence);free(l);
}
static GtkPicture *picture(napi_env e,napi_value v){uint64_t p=0;bool lossless=false;if(napi_get_value_bigint_uint64(e,v,&p,&lossless)!=napi_ok||!lossless)return NULL;return (GtkPicture*)(uintptr_t)p;}
static napi_value present_gpu(napi_env e,napi_callback_info ci){
 size_t n=3;napi_value a[3];napi_get_cb_info(e,ci,&n,a,NULL,NULL);GtkPicture*p=picture(e,a[0]);if(!p||!GTK_IS_PICTURE(p)||!releases)return fail(e,"Invalid texture target");
 int w=prop(e,a[1],"width"),h=prop(e,a[1],"height"),fourcc=prop(e,a[1],"fourcc");
 napi_value value;napi_get_named_property(e,a[1],"modifier",&value);uint64_t modifier=0;bool lossless=false;
 if(napi_get_value_bigint_uint64(e,value,&modifier,&lossless)!=napi_ok||!lossless||w<1||h<1||w>8192||h>8192)return fail(e,"Invalid texture layout");
 uint32_t count;napi_get_array_length(e,a[2],&count);if(count<1||count>4)return fail(e,"Invalid texture planes");
 Lease*l=calloc(1,sizeof(*l));l->count=count; l->sequence=(uint64_t)prop(e,a[1],"sequence");
 GdkDmabufTextureBuilder*b=gdk_dmabuf_texture_builder_new();gdk_dmabuf_texture_builder_set_display(b,gtk_widget_get_display(GTK_WIDGET(p)));
 gdk_dmabuf_texture_builder_set_width(b,w);gdk_dmabuf_texture_builder_set_height(b,h);gdk_dmabuf_texture_builder_set_fourcc(b,(guint32)fourcc);
 gdk_dmabuf_texture_builder_set_modifier(b,modifier);gdk_dmabuf_texture_builder_set_n_planes(b,count);gdk_dmabuf_texture_builder_set_premultiplied(b,TRUE);
 for(uint32_t i=0;i<count;i++){napi_value plane;napi_get_element(e,a[2],i,&plane);l->fds[i]=prop(e,plane,"fd");
  gdk_dmabuf_texture_builder_set_fd(b,i,l->fds[i]);gdk_dmabuf_texture_builder_set_stride(b,i,prop(e,plane,"stride"));gdk_dmabuf_texture_builder_set_offset(b,i,prop(e,plane,"offset"));}
 GError*error=NULL;GdkTexture*t=gdk_dmabuf_texture_builder_build(b,destroy_lease,l,&error);g_object_unref(b);
 if(!t){free(l);napi_value result=fail(e,error?error->message:"DMA-BUF import failed");g_clear_error(&error);return result;}
 gtk_picture_set_paintable(p,GDK_PAINTABLE(t));g_object_unref(t);return number(e,1);
}
static napi_value present_bitmap(napi_env e,napi_callback_info ci){
 size_t n=4;napi_value a[4];napi_get_cb_info(e,ci,&n,a,NULL,NULL);GtkPicture*p=picture(e,a[0]);void*data=NULL;size_t size=0;
 int w=integer(e,a[1]),h=integer(e,a[2]);napi_get_buffer_info(e,a[3],&data,&size);
 if(!p||!GTK_IS_PICTURE(p)||w<1||h<1||w>8192||h>8192||size!=(size_t)w*h*4||size>FRAME_BYTES)return fail(e,"Invalid bitmap");
 GBytes*bytes=g_bytes_new(data,size);GdkTexture*t=gdk_memory_texture_new(w,h,GDK_MEMORY_B8G8R8A8_PREMULTIPLIED,bytes,w*4);g_bytes_unref(bytes);
 gtk_picture_set_paintable(p,GDK_PAINTABLE(t));g_object_unref(t);return number(e,1);
}
static napi_value capture(napi_env e,napi_callback_info ci){
 size_t n=2;napi_value a[2];napi_get_cb_info(e,ci,&n,a,NULL,NULL);GtkPicture*p=picture(e,a[0]);
 if(!p||!GTK_IS_PICTURE(p))return fail(e,"Invalid picture");GdkPaintable*paintable=gtk_picture_get_paintable(p);if(!GDK_IS_TEXTURE(paintable))return fail(e,"No texture");
 GdkTexture*t=GDK_TEXTURE(paintable);int w=gdk_texture_get_width(t),h=gdk_texture_get_height(t);size_t stride=w*4UL;guchar*data=g_malloc(stride*h);gdk_texture_download(t,data,stride);
 guint32 first=0;memcpy(&first,data,4);int varied=0;for(size_t i=4;i<stride*h;i+=4096){guint32 sample;memcpy(&sample,data+i,4);if(first!=sample){varied=1;break;}}g_free(data);
 char file[4096];size_t length=0;if(napi_get_value_string_utf8(e,a[1],file,sizeof(file),&length)==napi_ok&&length)gdk_texture_save_to_png(t,file);
 napi_value out;napi_create_array_with_length(e,3,&out);napi_set_element(e,out,0,number(e,w));napi_set_element(e,out,1,number(e,h));napi_set_element(e,out,2,number(e,varied));return out;
}
NAPI_MODULE_INIT(){napi_property_descriptor properties[]={
 {"capture",0,capture,0,0,0,napi_default,0},{"channels",0,channels,0,0,0,napi_default,0},{"receiveTexture",0,receive_texture,0,0,0,napi_default,0},
 {"onRelease",0,on_release,0,0,0,napi_default,0},{"presentGPU",0,present_gpu,0,0,0,napi_default,0},{"presentBitmap",0,present_bitmap,0,0,0,napi_default,0}};
 napi_define_properties(env,exports,sizeof(properties)/sizeof(properties[0]),properties);return exports;}
