/*
  max-window-effect@nls1729 - Gnome Shell Extension

  Copyright (c) 2014-2016 Norman L. Smith
  Ported to GNOME Shell 51 in 2026.

  SPDX-License-Identifier: GPL-2.0-or-later
*/

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const OPAQUE_STYLE = 'background-color: black;';

export default class MaxWindowEffectExtension extends Extension {
    enable() {
        this._savedStyle = Main.panel.style;
        this._tracked = new Map();
        this._signals = [];
        this._updateId = 0;
        this._opaque = false;

        this._listen(global.display, 'window-created', (_display, window) => {
            this._track(window);
            this._schedule();
        });
        this._listen(global.display, 'restacked', () => this._schedule());
        this._listen(global.workspace_manager, 'active-workspace-changed', () => this._schedule());

        const actors = global.compositor?.get_window_actors?.() ?? [];
        for (const actor of actors)
            this._track(actor.metaWindow ?? actor.meta_window);
        this._update();
    }

    disable() {
        if (this._updateId) {
            GLib.source_remove(this._updateId);
            this._updateId = 0;
        }
        for (const [object, id] of this._signals) {
            try {
                object.disconnect(id);
            } catch {
                // The object is already gone.
            }
        }
        this._signals = [];
        for (const window of [...this._tracked.keys()])
            this._untrack(window);
        if (this._opaque)
            Main.panel.set_style(this._savedStyle);
        this._opaque = false;
        this._savedStyle = null;
    }

    _listen(object, signal, handler) {
        this._signals.push([object, object.connect(signal, handler)]);
    }

    _track(window) {
        if (!window || this._tracked.has(window))
            return;
        const ids = [];
        for (const signal of [
            'notify::maximized-horizontally',
            'notify::maximized-vertically',
            'size-changed',
            'unmanaged',
        ]) {
            try {
                ids.push(window.connect(signal, () => {
                    if (signal === 'unmanaged')
                        GLib.idle_add_once(GLib.PRIORITY_DEFAULT, () => this._untrack(window));
                    this._schedule();
                }));
            } catch {
                // Signal is absent on this mutter build.
            }
        }
        this._tracked.set(window, ids);
    }

    _untrack(window) {
        const ids = this._tracked.get(window);
        if (!ids)
            return;
        for (const id of ids) {
            try {
                window.disconnect(id);
            } catch {
                // The window is already gone.
            }
        }
        this._tracked.delete(window);
    }

    _schedule() {
        if (this._updateId)
            return;
        this._updateId = GLib.idle_add_once(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._updateId = 0;
            this._update();
        });
    }

    _primaryMaximized() {
        const monitor = Main.layoutManager.primaryMonitor;
        const workspace = global.workspace_manager.get_active_workspace();
        if (!monitor || !workspace)
            return false;
        return workspace.list_windows().some(window => {
            if (window.get_monitor() !== monitor.index)
                return false;
            if (window.minimized || !window.showing_on_its_workspace())
                return false;
            if (window.get_window_type() !== Meta.WindowType.NORMAL)
                return false;
            return window.maximized_horizontally && window.maximized_vertically;
        });
    }

    _update() {
        const occupied = this._primaryMaximized();
        if (occupied && !this._opaque) {
            this._savedStyle = Main.panel.style;
            Main.panel.set_style(OPAQUE_STYLE);
            this._opaque = true;
        } else if (!occupied && this._opaque) {
            Main.panel.set_style(this._savedStyle);
            this._opaque = false;
        }
    }
}
