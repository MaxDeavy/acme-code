/*
  Do Not Disturb Button Gnome Shell Extension

  Copyright (c) 2015-2019 Norman L. Smith
  Ported to GNOME Shell 51 in 2026.

  SPDX-License-Identifier: GPL-2.0-or-later
*/

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gvc from 'gi://Gvc';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as GnomeSession from 'resource:///org/gnome/shell/misc/gnomeSession.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const NOTIFICATION_SCHEMA = 'org.gnome.desktop.notifications';
const SHORTCUT = 'shortcut';

const DoNotDisturbButton = GObject.registerClass(
class DoNotDisturbButton extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, 'Do Not Disturb', true);
        this._extension = extension;
        this._busyIcon = new St.Icon({style_class: 'system-status-icon'});
        this._availableIcon = new St.Icon({style_class: 'system-status-icon'});
        this._count = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this._timeoutMark = new St.Label({y_align: Clutter.ActorAlign.CENTER});

        const box = new St.BoxLayout();
        box.add_child(this._availableIcon);
        box.add_child(this._busyIcon);
        box.add_child(this._timeoutMark);
        box.add_child(this._count);
        this.add_child(box);

        const click = new Clutter.ClickGesture();
        click.set_recognize_on_press(true);
        try {
            click.button = 0;
        } catch {
            // Primary button only.
        }
        click.connect('recognize', () => {
            const event = click.get_point_event?.(0);
            const button = event?.get_button?.() ?? 1;
            if (button === 3)
                extension.openPreferences();
            else
                extension.toggle();
        });
        this.add_action(click);
    }

    setIcons(availablePath, busyPath) {
        this._availableIcon.gicon = Gio.icon_new_for_string(availablePath);
        this._busyIcon.gicon = Gio.icon_new_for_string(busyPath);
    }

    setBusy(busy) {
        this._busyIcon.visible = busy;
        this._availableIcon.visible = !busy;
    }

    setCount(count, show) {
        this._count.text = show && count > 0 ? `${count}` : '';
    }

    setTimeoutActive(active) {
        this._timeoutMark.text = active ? '\u23f3' : '';
    }
});

export default class DoNotDisturbExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._notifications = new Gio.Settings({schema_id: NOTIFICATION_SCHEMA});
        this._signals = [];
        this._button = null;
        this._timeoutId = 0;
        this._countId = 0;
        this._remaining = 0;
        this._presence = null;
        this._mixer = null;
        this._sink = null;
        this._applying = false;

        this._button = new DoNotDisturbButton(this);
        const [position, box] = panelPosition(this._settings);
        Main.panel.addToStatusArea('DoNotDisturb', this._button, position, box);
        this._reloadIcons();
        this._addKeybinding();
        this._watchPresence();
        this._watchMixer();

        this._listen(this._settings, 'changed::panel-icon-left', () => this._replaceButton());
        this._listen(this._settings, 'changed::panel-icon-center', () => this._replaceButton());
        this._listen(this._settings, 'changed::reset-icon', () => this._reloadIcons());
        this._listen(this._settings, 'changed::available-icon', () => this._reloadIcons());
        this._listen(this._settings, 'changed::busy-icon', () => this._reloadIcons());
        this._listen(this._settings, 'changed::panel-count-show', () => this._refreshCount());
        this._listen(this._settings, 'changed::shortcut', () => this._addKeybinding());
        this._listen(this._settings, 'changed::mute-busy', () => this._applyMute());
        this._listen(this._settings, 'changed::unmute-available', () => this._applyMute());
        this._listen(this._notifications, 'changed::show-banners', () => {
            if (!this._applying)
                this._applyBusy(!this._notifications.get_boolean('show-banners'), false);
        });

        let busy = this._settings.get_boolean('busy-state');
        if (this._settings.get_boolean('override'))
            busy = this._settings.get_boolean('overrride-busy-state');
        this._applyBusy(busy, true);

        this._countId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._refreshCount();
            return GLib.SOURCE_CONTINUE;
        });
        this._refreshCount();
    }

    disable() {
        this._clearTimers();
        this._removeKeybinding();
        for (const [object, id] of this._signals) {
            try {
                object.disconnect(id);
            } catch {
                // Already gone.
            }
        }
        this._signals = [];
        this._presence = null;
        if (this._mixer) {
            this._mixer.close();
            this._mixer = null;
            this._sink = null;
        }
        this._button?.destroy();
        this._button = null;
        this._settings = null;
        this._notifications = null;
    }

    toggle() {
        this._applyBusy(!this._busy, true);
    }

    _replaceButton() {
        const busy = this._busy;
        const timeoutActive = this._timeoutId !== 0;
        this._button?.destroy();
        this._button = new DoNotDisturbButton(this);
        const [position, box] = panelPosition(this._settings);
        Main.panel.addToStatusArea('DoNotDisturb', this._button, position, box);
        this._reloadIcons();
        this._button.setBusy(busy);
        this._button.setTimeoutActive(timeoutActive);
        this._refreshCount();
    }

    _listen(object, signal, handler) {
        this._signals.push([object, object.connect(signal, handler)]);
    }

    _reloadIcons() {
        const available = this._iconPath('available-icon', 'available-notifications-symbolic.svg');
        const busy = this._iconPath('busy-icon', 'busy-notifications-symbolic.svg');
        this._button?.setIcons(available, busy);
    }

    _iconPath(key, fallbackFile) {
        const configured = this._settings.get_string(key);
        if (configured !== 'default' && GLib.file_test(configured, GLib.FileTest.EXISTS))
            return configured;
        return GLib.build_filenamev([this.path, fallbackFile]);
    }

    _watchPresence() {
        this._presence = GnomeSession.Presence(() => {});
        this._presence.connectSignal('StatusChanged', (_proxy, _sender, [status]) => {
            if (!this._settings || this._applying)
                return;
            const busy = status === GnomeSession.PresenceStatus.BUSY;
            if (busy !== this._busy)
                this._applyBusy(busy, true);
        });
    }

    _watchMixer() {
        this._mixer = new Gvc.MixerControl({name: 'Do Not Disturb'});
        this._listen(this._mixer, 'state-changed', () => {
            if (this._mixer.get_state() === Gvc.MixerControlState.READY) {
                this._sink = this._mixer.get_default_sink();
                this._applyMute();
            }
        });
        this._listen(this._mixer, 'default-sink-changed', () => {
            this._sink = this._mixer.get_default_sink();
            this._applyMute();
        });
        this._mixer.open();
    }

    _applyBusy(busy, writeBanner) {
        if (!this._settings)
            return;
        this._applying = true;
        try {
            this._busy = busy;
            this._settings.set_boolean('busy-state', busy);
            this._button?.setBusy(busy);
            if (writeBanner && this._notifications.get_boolean('show-banners') === busy)
                this._notifications.set_boolean('show-banners', !busy);

            const status = busy
                ? GnomeSession.PresenceStatus.BUSY
                : GnomeSession.PresenceStatus.AVAILABLE;
            try {
                this._presence?.SetStatusRemote(status);
            } catch (error) {
                console.debug(`${this.uuid}: presence update failed: ${error}`);
            }
            this._applyMute();
            this._armTimeout();
        } finally {
            this._applying = false;
        }
    }

    _applyMute() {
        if (!this._sink)
            return;
        const muteWhenBusy = this._settings.get_boolean('mute-busy');
        const unmuteWhenAvailable = this._settings.get_boolean('unmute-available');
        let muted = null;
        if (this._busy && muteWhenBusy)
            muted = true;
        else if (!this._busy && unmuteWhenAvailable)
            muted = false;
        if (muted === null)
            return;
        if (this._sink.change_is_muted)
            this._sink.change_is_muted(muted);
        else
            this._sink.is_muted = muted;
    }

    _armTimeout() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        const enabled = this._settings.get_boolean('time-out-enabled');
        this._button?.setTimeoutActive(enabled && this._busy);
        if (!enabled || !this._busy)
            return;

        const minutes = Math.max(1, this._settings.get_int('time-out-interval'));
        this._remaining = minutes;
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            this._remaining -= 1;
            if (this._remaining > 0)
                return GLib.SOURCE_CONTINUE;
            this._timeoutId = 0;
            if (!this._settings.get_boolean('time-out-always'))
                this._settings.set_boolean('time-out-enabled', false);
            this._applyBusy(false, true);
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearTimers() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        if (this._countId) {
            GLib.source_remove(this._countId);
            this._countId = 0;
        }
    }

    _refreshCount() {
        this._button?.setCount(
            countNotifications(),
            this._settings?.get_boolean('panel-count-show'));
    }

    _addKeybinding() {
        this._removeKeybinding();
        Main.wm.addKeybinding(
            SHORTCUT,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            () => this.toggle());
    }

    _removeKeybinding() {
        try {
            Main.wm.removeKeybinding(SHORTCUT);
        } catch {
            // The binding is not installed yet.
        }
    }
}

function panelPosition(settings) {
    const center = settings.get_boolean('panel-icon-center');
    const left = settings.get_boolean('panel-icon-left');
    if (center) {
        const box = Main.panel._centerBox;
        return [left ? 0 : box.get_n_children(), 'center'];
    }
    if (left)
        return [Main.panel._leftBox.get_n_children(), 'left'];
    return [0, 'right'];
}

function countNotifications() {
    const tray = Main.messageTray;
    if (!tray)
        return 0;
    if (typeof tray.count === 'number')
        return tray.count;
    const sources = typeof tray.getSources === 'function' ? tray.getSources() : [];
    let count = 0;
    for (const source of sources) {
        if (typeof source.unseenCount === 'number')
            count += source.unseenCount;
        else if (typeof source.count === 'number')
            count += source.count;
        else if (Array.isArray(source.notifications))
            count += source.notifications.length;
    }
    return count;
}
