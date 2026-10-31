/* Process-local GTK3 appearance for Electron's native menu and frame colors.
 * Uses Node-API, never exposes GTK or Node to the Amazon renderer. */
#include <node_api.h>
#include <gtk/gtk.h>
#include <cairo.h>

static napi_value boolean(napi_env env, gboolean value) {
  napi_value result; napi_get_boolean(env, value, &result); return result;
}
static napi_value set_dark(napi_env env, napi_callback_info info) {
  napi_value argument; size_t count = 1; bool dark = false;
  napi_get_cb_info(env, info, &count, &argument, NULL, NULL);
  if (count != 1 || napi_get_value_bool(env, argument, &dark) != napi_ok) {
    napi_throw_type_error(env, NULL, "Expected a boolean appearance preference"); return NULL;
  }
  GtkSettings *settings = gtk_settings_get_default();
  if (!settings) { napi_throw_error(env, NULL, "GTK3 is not initialized"); return NULL; }
  gboolean previous = FALSE; char *theme = NULL;
  g_object_get(settings, "gtk-application-prefer-dark-theme", &previous, "gtk-theme-name", &theme, NULL);
  // GNOME may advertise the fixed Adwaita-dark name. Select its base theme so
  // the per-application preference can switch both ways without changing GNOME.
  if (g_strcmp0(theme, "Adwaita-dark") == 0)
    g_object_set(settings, "gtk-theme-name", "Adwaita", NULL);
  g_free(theme);
  // Setting an unchanged value can trigger a GTK/NativeTheme notification loop.
  if (previous != dark) g_object_set(settings, "gtk-application-prefer-dark-theme", dark, NULL);
  return boolean(env, dark);
}
static napi_value color(napi_env env, GtkWidget *base, GtkWidget *widget) {
  cairo_surface_t *surface = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, 100, 36);
  cairo_t *cr = cairo_create(surface);
  gtk_render_background(gtk_widget_get_style_context(base), cr, 0, 0, 100, 36);
  gtk_render_background(gtk_widget_get_style_context(widget), cr, 0, 0, 100, 36);
  cairo_surface_flush(surface);
  unsigned char *pixel = cairo_image_surface_get_data(surface) + 18 * cairo_image_surface_get_stride(surface) + 50 * 4;
  napi_value result; napi_create_array_with_length(env, 3, &result);
  const int channels[] = {pixel[2], pixel[1], pixel[0]};
  for (unsigned i = 0; i < 3; ++i) { napi_value n; napi_create_int32(env, channels[i], &n); napi_set_element(env, result, i, n); }
  cairo_destroy(cr); cairo_surface_destroy(surface); return result;
}
static napi_value inspect(napi_env env, napi_callback_info info) {
  (void)info;
  GtkSettings *settings = gtk_settings_get_default();
  if (!settings) { napi_throw_error(env, NULL, "GTK3 is not initialized"); return NULL; }
  gboolean dark = FALSE; char *theme = NULL;
  g_object_get(settings, "gtk-application-prefer-dark-theme", &dark, "gtk-theme-name", &theme, NULL);
  napi_value result, name; napi_create_object(env, &result);
  napi_set_named_property(env, result, "preferDark", boolean(env, dark));
  napi_create_string_utf8(env, theme ? theme : "", NAPI_AUTO_LENGTH, &name);
  napi_set_named_property(env, result, "theme", name); g_free(theme);
  // Render the actual GTK styles Electron uses, rather than testing only the
  // unrelated renderer prefers-color-scheme query. No window is presented.
  GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  GtkWidget *menu = gtk_menu_bar_new(), *header = gtk_header_bar_new();
  gtk_widget_set_name(menu, "menubar");
  gtk_style_context_add_class(gtk_widget_get_style_context(header), GTK_STYLE_CLASS_TITLEBAR);
  gtk_window_set_titlebar(GTK_WINDOW(window), header);
  gtk_container_add(GTK_CONTAINER(window), menu);
  napi_set_named_property(env, result, "menuRGB", color(env, window, menu));
  napi_set_named_property(env, result, "titlebarRGB", color(env, window, header));
  gtk_widget_destroy(window);
  return result;
}
static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    {"setDark", NULL, set_dark, NULL, NULL, NULL, napi_default, NULL},
    {"inspect", NULL, inspect, NULL, NULL, NULL, napi_default, NULL}
  };
  napi_define_properties(env, exports, 2, methods); return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
