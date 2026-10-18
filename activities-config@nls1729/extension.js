/*
  Activities Configurator Gnome Shell Extension

  Copyright (c) 2012-2020 Norman L. Smith
  Ported to GNOME Shell 51 in 2026.

  SPDX-License-Identifier: GPL-2.0-or-later
*/

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import * as Colors from './colors.js';
import * as Keys from './keys.js';

const INTERFACE_SCHEMA = 'org.gnome.desktop.interface';
const DEFAULT_HOT_CORNER_THRESHOLD = 100;
const DEFAULT_HOT_CORNER_TIMEOUT = 1000;

const ActivitiesButton = GObject.registerClass(
class ActivitiesButton extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Activities', true);
        this._extension = extension;

        this.set({
            name: 'panelActivitiesIconButton',
            accessible_role: Atk.Role.TOGGLE_BUTTON,
            accessible_name: 'Activities',
            track_hover: true,
        });
        this.container.name = 'panelActivitiesIconButtonContainer';

        this._icon = new St.Icon({
            style_class: 'activities-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label.clutter_text?.set_use_markup(true);

        const box = new St.BoxLayout();
        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);

        const click = new Clutter.ClickGesture();
        click.set_recognize_on_press(true);
        try {
            click.button = 0;
        } catch {
            // Older ClickGesture builds only recognize the primary button.
        }
        click.connect('recognize', () => {
            const event = click.get_point_event?.(0);
            const button = event?.get_button?.() ?? 1;
            if (button === 3)
                this._extension.openPreferences();
            else
                this._toggleOverview();
        });
        this.add_action(click);

        Main.overview.connectObject(
            'showing', () => this.add_style_pseudo_class('checked'),
            'hiding', () => this.remove_style_pseudo_class('checked'),
            this);
    }

    _toggleOverview() {
        if (Main.overview.shouldToggleByCornerOrButton())
            Main.overview.toggle();
    }

    vfunc_scroll_event(event) {
        return Main.wm.handleWorkspaceScroll(event);
    }

    _onDestroy() {
        Main.overview.disconnectObject(this);
        super._onDestroy();
    }
});

export default class ActivitiesConfigExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._signals = [];
        this._tracked = new Map();
        this._button = null;
        this._enabled = false;
        this._savedPanelStyle = null;
        this._styleSaved = false;
        this._hidStock = false;
        this._savedHotCorners = null;
        this._interfaceSettings = new Gio.Settings({schema_id: INTERFACE_SCHEMA});
        this._enableId = 0;
        this._panelUpdateId = 0;

        if (Main.sessionMode.currentMode === 'classic')
            this._settings.set_boolean(Keys.CON_DET, true);

        if (this._settings.get_boolean(Keys.FIRST_ENABLE)) {
            this._settings.set_string(Keys.NEW_ICO, this._bundledIcon());
            this._settings.set_boolean(Keys.FIRST_ENABLE, false);
        }

        const delay = this._settings.get_boolean(Keys.DISABLE_ENABLE_DELAY) ? 5 : 1500;
        this._enableId = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, delay, () => {
            this._enableId = 0;
            this._enableNow();
        });
    }

    disable() {
        if (this._enableId) {
            GLib.source_remove(this._enableId);
            this._enableId = 0;
        }
        if (this._panelUpdateId) {
            GLib.source_remove(this._panelUpdateId);
            this._panelUpdateId = 0;
        }

        this._disconnectAll();
        this._untrackAll();

        if (this._savedHotCorners !== null) {
            this._interfaceSettings.set_boolean('enable-hot-corners', this._savedHotCorners);
            this._restoreHotCornerDefaults();
            this._savedHotCorners = null;
        }

        if (this._styleSaved) {
            Main.panel.set_style(this._savedPanelStyle);
            this._savedPanelStyle = null;
            this._styleSaved = false;
        }

        const stock = Main.panel.statusArea.activities;
        if (this._hidStock) {
            stock?.container.disconnectObject(this);
            stock?.container.show();
            this._hidStock = false;
        }

        this._button?.destroy();
        this._button = null;
        this._settings = null;
        this._enabled = false;
    }

    _enableNow() {
        this._enabled = true;
        this._savedPanelStyle = Main.panel.style;
        this._styleSaved = true;
        this._savedHotCorners = this._interfaceSettings.get_boolean('enable-hot-corners');
        this._hideStockActivities();
        this._placeButton();
        this._connectSettings();
        this._listen(Main.layoutManager, 'hot-corners-changed', () => this._syncHotCorners());
        this._listen(Main.layoutManager, 'monitors-changed', () => this._syncHotCorners());
        this._syncHotCorners();
        this._connectWindows();
        this._applyPanelStyle();

        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        this._listen(themeContext, 'changed', () => this._schedulePanelUpdate());

        if (this._settings.get_boolean(Keys.SHOW_OVERVIEW))
            this._showOverviewIfEmpty();

        console.debug(`${this.uuid} enabled`);
    }

    _bundledIcon() {
        return GLib.build_filenamev([this.path, Keys.ICON_FILE]);
    }

    _hideStockActivities() {
        const stock = Main.panel.statusArea.activities;
        if (!stock)
            return;
        stock.container.connectObject('notify::visible', () => {
            if (this._enabled && stock.container.visible)
                stock.container.hide();
        }, this);
        stock.container.hide();
        this._hidStock = true;
    }

    _placeButton() {
        this._button?.destroy();
        this._button = new ActivitiesButton(this);
        const right = this._settings.get_boolean(Keys.BTN_POSITION);
        const box = right ? Main.panel._rightBox : Main.panel._leftBox;
        const position = right ? box.get_n_children() : 0;
        Main.panel.addToStatusArea(
            'activities-icon-button',
            this._button,
            position,
            right ? 'right' : 'left');
        this._applyButtonLook();
        this._applyRemoved();
        this._resolveConflict();
    }

    _connectSettings() {
        const refreshLook = () => this._applyButtonLook();
        const keys = [
            [Keys.NEW_ICO, refreshLook],
            [Keys.NO_ICON, refreshLook],
            [Keys.PAD_ICO, refreshLook],
            [Keys.SCF_ICO, refreshLook],
            [Keys.NEW_TXT, refreshLook],
            [Keys.NO_TEXT, refreshLook],
            [Keys.PAD_TXT, refreshLook],
            [Keys.REMOVED, () => this._applyRemoved()],
            [Keys.BTN_POSITION, () => this._placeButton()],
            [Keys.NO_HOTC, () => this._syncHotCorners()],
            [Keys.HOTC_PT, () => this._syncHotCorners()],
            [Keys.HOTC_TO, () => this._syncHotCorners()],
            [Keys.COLOURS, () => this._schedulePanelUpdate()],
            [Keys.TRS_PAN, () => this._schedulePanelUpdate()],
            [Keys.OVERR_THEME, () => this._schedulePanelUpdate()],
            [Keys.SHADOW_COLOR, () => this._schedulePanelUpdate()],
            [Keys.SHADOW_TRANS, () => this._schedulePanelUpdate()],
            [Keys.SHADOW_LEN, () => this._schedulePanelUpdate()],
            [Keys.SHADOW_BLUR, () => this._schedulePanelUpdate()],
            [Keys.SHADOW_SPRED, () => this._schedulePanelUpdate()],
            [Keys.MAX_WIN_EFFECT, () => this._schedulePanelUpdate()],
            [Keys.TILE_OFF, () => this._schedulePanelUpdate()],
            [Keys.CON_DET, () => this._resolveConflict()],
            [Keys.SHOW_OVERVIEW, () => {
                if (this._settings.get_boolean(Keys.SHOW_OVERVIEW))
                    this._showOverviewIfEmpty();
            }],
        ];
        for (const [key, handler] of keys)
            this._listen(this._settings, `changed::${key}`, handler);

        this._listen(Main.panel._leftBox, 'child-added', () => this._resolveConflict());

        const appSystem = Shell.AppSystem.get_default();
        this._listen(appSystem, 'app-state-changed', (_sys, app) => {
            if (!this._settings.get_boolean(Keys.SHOW_OVERVIEW))
                return;
            if (app.state === Shell.AppState.STOPPED)
                this._showOverviewIfEmpty();
            else if (Main.overview.visible)
                Main.overview.toggle();
        });
    }

    _listen(object, signal, handler) {
        const id = object.connect(signal, handler);
        this._signals.push([object, id]);
        return id;
    }

    _disconnectAll() {
        for (const [object, id] of this._signals) {
            try {
                object.disconnect(id);
            } catch {
                // The object may already have been destroyed.
            }
        }
        this._signals = [];
    }

    _applyButtonLook() {
        if (!this._button)
            return;

        let iconPath = this._settings.get_string(Keys.NEW_ICO);
        if (!GLib.file_test(iconPath, GLib.FileTest.EXISTS))
            iconPath = this._bundledIcon();

        const hideIcon = this._settings.get_boolean(Keys.NO_ICON) ||
            !GLib.file_test(iconPath, GLib.FileTest.EXISTS);
        if (hideIcon) {
            this._button._icon.hide();
        } else {
            const pad = this._settings.get_int(Keys.PAD_ICO);
            const scale = this._settings.get_double(Keys.SCF_ICO);
            this._button._icon.gicon = Gio.icon_new_for_string(iconPath);
            this._button._icon.style =
                `icon-size: ${scale}em; padding-left: ${pad}px; padding-right: ${pad}px;`;
            this._button._icon.show();
        }

        let text = this._settings.get_string(Keys.NEW_TXT);
        if (!text)
            text = 'Activities';
        if (this._settings.get_boolean(Keys.NO_TEXT))
            text = '';
        this._button._label.text = text;
        if (text) {
            const pad = this._settings.get_int(Keys.PAD_TXT);
            this._button._label.style =
                `padding-left: ${pad}px; padding-right: ${pad}px;`;
            this._button._label.show();
        } else {
            this._button._label.hide();
        }
    }

    _applyRemoved() {
        if (!this._button)
            return;
        if (this._settings.get_boolean(Keys.REMOVED))
            this._button.container.hide();
        else
            this._button.container.show();
    }

    _resolveConflict() {
        if (this._resolving || !this._button || !this._settings.get_boolean(Keys.CON_DET))
            return;
        if (this._settings.get_boolean(Keys.BTN_POSITION))
            return;

        const box = Main.panel._leftBox;
        const container = this._button.container;
        if (!container.get_parent() || box.get_first_child() === container)
            return;

        this._resolving = true;
        try {
            container.get_parent().remove_child(container);
            box.insert_child_at_index(container, 0);
        } finally {
            this._resolving = false;
        }
    }

    _syncHotCorners() {
        if (this._savedHotCorners === null)
            return;
        const disable = this._settings.get_boolean(Keys.NO_HOTC);
        const enabled = this._interfaceSettings.get_boolean('enable-hot-corners');
        if (disable && enabled)
            this._interfaceSettings.set_boolean('enable-hot-corners', false);
        else if (!disable && !enabled)
            this._interfaceSettings.set_boolean('enable-hot-corners', true);
        if (disable)
            return;

        const threshold = this._settings.get_int(Keys.HOTC_PT);
        const timeout = this._settings.get_int(Keys.HOTC_TO);
        for (const corner of Main.layoutManager.hotCorners) {
            const barrier = corner?._pressureBarrier;
            if (!barrier)
                continue;
            barrier._threshold = threshold;
            barrier._timeout = timeout;
        }
    }

    _restoreHotCornerDefaults() {
        if (!this._interfaceSettings.get_boolean('enable-hot-corners'))
            return;
        for (const corner of Main.layoutManager.hotCorners) {
            const barrier = corner?._pressureBarrier;
            if (!barrier)
                continue;
            barrier._threshold = DEFAULT_HOT_CORNER_THRESHOLD;
            barrier._timeout = DEFAULT_HOT_CORNER_TIMEOUT;
        }
    }

    _connectWindows() {
        this._listen(global.display, 'window-created', (_display, window) => {
            this._trackWindow(window);
            this._schedulePanelUpdate();
        });
        this._listen(global.display, 'restacked', () => this._schedulePanelUpdate());
        this._listen(global.workspace_manager, 'active-workspace-changed', () => {
            this._schedulePanelUpdate();
        });

        const actors = global.compositor?.get_window_actors?.() ?? [];
        for (const actor of actors)
            this._trackWindow(actor.metaWindow ?? actor.meta_window);
    }

    _trackWindow(window) {
        if (!window || this._tracked.has(window))
            return;
        const ids = [];
        for (const signal of [
            'notify::maximized-horizontally',
            'notify::maximized-vertically',
            'size-changed',
            'position-changed',
            'unmanaged',
        ]) {
            try {
                ids.push(window.connect(signal, () => {
                    if (signal === 'unmanaged') {
                        GLib.idle_add_once(GLib.PRIORITY_DEFAULT, () => this._untrackWindow(window));
                    }
                    this._schedulePanelUpdate();
                }));
            } catch {
                // This mutter build does not expose the signal.
            }
        }
        this._tracked.set(window, ids);
    }

    _untrackWindow(window) {
        const ids = this._tracked.get(window);
        if (!ids)
            return;
        for (const id of ids) {
            try {
                window.disconnect(id);
            } catch {
                // Already unmanaged.
            }
        }
        this._tracked.delete(window);
    }

    _untrackAll() {
        for (const window of [...this._tracked.keys()])
            this._untrackWindow(window);
    }

    _schedulePanelUpdate() {
        if (this._panelUpdateId)
            return;
        this._panelUpdateId = GLib.idle_add_once(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._panelUpdateId = 0;
            if (this._enabled)
                this._applyPanelStyle();
        });
    }

    _primaryOccupied() {
        const monitor = Main.layoutManager.primaryMonitor;
        const workspace = global.workspace_manager.get_active_workspace();
        if (!monitor || !workspace)
            return false;

        const index = monitor.index;
        const top = monitor.y;
        const belowPanel = monitor.y + Main.layoutManager.panelBox.height;
        const half = monitor.width / 2;
        const tileOff = this._settings.get_boolean(Keys.TILE_OFF);
        const near = (a, b) => Math.abs(a - b) <= 2;

        for (const window of workspace.list_windows()) {
            if (window.get_monitor() !== index)
                continue;
            if (window.minimized || !window.showing_on_its_workspace())
                continue;
            const type = window.get_window_type();
            if (type !== Meta.WindowType.NORMAL && type !== Meta.WindowType.DIALOG)
                continue;
            if (window.maximized_horizontally && window.maximized_vertically)
                return true;
            if (tileOff)
                continue;

            const rect = window.get_frame_rect();
            const yOk = near(rect.y, top) || near(rect.y, belowPanel);
            const left = yOk && near(rect.x, monitor.x) && near(rect.width, half);
            const right = yOk && near(rect.x, monitor.x + half) && near(rect.width, half);
            if (left || right)
                return true;
        }
        return false;
    }

    _shadowCss() {
        const length = this._settings.get_int(Keys.SHADOW_LEN);
        if (length === 0)
            return '';
        const color = Colors.getColorStringCSS(
            Colors.getColorRGB(this._settings.get_string(Keys.SHADOW_COLOR)));
        const opacity = (100 - this._settings.get_int(Keys.SHADOW_TRANS)) / 100;
        const blur = this._settings.get_int(Keys.SHADOW_BLUR);
        const spread = this._settings.get_int(Keys.SHADOW_SPRED);
        return `box-shadow: 0px ${length}px ${blur}px ${spread}px rgba(${color},${opacity});`;
    }

    _applyPanelStyle() {
        if (!this._settings)
            return;

        const effect = this._settings.get_int(Keys.MAX_WIN_EFFECT);
        const occupied = effect > 0 && this._primaryOccupied();
        const userTheme = Boolean(Main.getThemeStylesheet?.()) ||
            Main.sessionMode.currentMode === 'classic';
        const override = this._settings.get_boolean(Keys.OVERR_THEME);

        if (!occupied && userTheme && !override) {
            Main.panel.set_style(null);
            return;
        }

        let color = Colors.getColorStringCSS(
            Colors.getColorRGB(this._settings.get_string(Keys.COLOURS)));
        let opacity = (100 - this._settings.get_int(Keys.TRS_PAN)) / 100;
        let shadow = this._shadowCss();
        if (occupied) {
            opacity = 1;
            shadow = '';
            if (effect === 2)
                color = '0,0,0';
        }

        Main.panel.set_style(
            `background-color: rgba(${color},${opacity});${shadow}`);
    }

    _showOverviewIfEmpty() {
        const workspace = global.workspace_manager.get_active_workspace();
        const windows = workspace?.list_windows().filter(win => {
            if (win.get_window_type() !== Meta.WindowType.NORMAL)
                return false;
            return !win.is_skip_taskbar?.();
        }) ?? [];
        if (windows.length === 0 && !Main.overview.visible &&
            Main.overview.shouldToggleByCornerOrButton())
            Main.overview.toggle();
    }
}
