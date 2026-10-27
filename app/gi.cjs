"use strict";
const gi = require("node-gtk");
module.exports = {
  gi,
  GLib: gi.require("GLib", "2.0"),
  Gio: gi.require("Gio", "2.0"),
  GObject: gi.require("GObject", "2.0"),
  Gtk: gi.require("Gtk", "4.0"),
  Gdk: gi.require("Gdk", "4.0"),
  Adw: gi.require("Adw", "1"),
};
