/* Private main-process Node-API bridge. SCM_RIGHTS transfers DMA-BUF ownership
 * across the inherited Unix socket; FD numbers cannot be sent as JSON alone. */
#include <node_api.h>
#include <errno.h>
#include <string.h>
#include <sys/socket.h>

static napi_value send_texture(napi_env env, napi_callback_info info) {
    size_t argc = 3, length = 0;
    napi_value args[3], result;
    int32_t socket_fd, fds[4];
    uint32_t count;
    void *body;
    bool is_buffer = false, is_array = false;
    if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok || argc != 3 ||
        napi_get_value_int32(env, args[0], &socket_fd) != napi_ok || socket_fd < 3 ||
        napi_is_buffer(env, args[1], &is_buffer) != napi_ok || !is_buffer ||
        napi_get_buffer_info(env, args[1], &body, &length) != napi_ok || !length || length > 8192 ||
        napi_is_array(env, args[2], &is_array) != napi_ok || !is_array ||
        napi_get_array_length(env, args[2], &count) != napi_ok || !count || count > 4) {
        napi_throw_type_error(env, NULL, "Invalid private texture packet"); return NULL;
    }
    for (uint32_t i = 0; i < count; i++) {
        napi_value value;
        if (napi_get_element(env, args[2], i, &value) != napi_ok ||
            napi_get_value_int32(env, value, &fds[i]) != napi_ok || fds[i] < 0) {
            napi_throw_type_error(env, NULL, "Invalid texture descriptor"); return NULL;
        }
    }
    union { struct cmsghdr alignment; char bytes[CMSG_SPACE(sizeof(fds))]; } control = {0};
    struct iovec data = {.iov_base = body, .iov_len = length};
    struct msghdr message = {.msg_iov = &data, .msg_iovlen = 1,
                            .msg_control = control.bytes, .msg_controllen = CMSG_SPACE(count * sizeof(int))};
    struct cmsghdr *rights = CMSG_FIRSTHDR(&message);
    rights->cmsg_level = SOL_SOCKET; rights->cmsg_type = SCM_RIGHTS;
    rights->cmsg_len = CMSG_LEN(count * sizeof(int));
    memcpy(CMSG_DATA(rights), fds, count * sizeof(int));
    ssize_t sent;
    do { sent = sendmsg(socket_fd, &message, MSG_DONTWAIT | MSG_NOSIGNAL); } while (sent < 0 && errno == EINTR);
    if (sent < 0 && errno != EAGAIN && errno != EWOULDBLOCK) {
        napi_throw_error(env, NULL, strerror(errno)); return NULL;
    }
    napi_get_boolean(env, sent == (ssize_t)length, &result);
    return result;
}

NAPI_MODULE_INIT() {
    napi_value function;
    napi_create_function(env, "send", NAPI_AUTO_LENGTH, send_texture, NULL, &function);
    napi_set_named_property(env, exports, "send", function);
    return exports;
}
