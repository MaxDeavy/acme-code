/*
  Gnome Shell Extension Reloader

  Copyright (c) 2016-2020 Norman L. Smith
  Ported to GNOME Shell 51 in 2026.

  SPDX-License-Identifier: GPL-2.0-or-later
*/

import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const ROLE = 'extension-reloader-indicator';

const STATE_TEXT = {
    [ExtensionState.ACTIVE]: 'Active',
    [ExtensionState.INACTIVE]: 'Inactive',
    [ExtensionState.ERROR]: 'Error',
    [ExtensionState.OUT_OF_DATE]: 'Out of Date',
    [ExtensionState.DOWNLOADING]: 'Downloading',
    [ExtensionState.INITIALIZED]: 'Initialized',
    [ExtensionState.DEACTIVATING]: 'Deactivating',
    [ExtensionState.ACTIVATING]: 'Activating',
    [ExtensionState.UNINSTALLED]: 'Uninstalled',
};

const ReloadMenu = GObject.registerClass(
class ReloadMenu extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Reload Extension Menu');
        const icon = new St.Icon({
            icon_name: 'view-refresh-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(icon);
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._populate();
        });
    }

    _populate() {
        this.menu.removeAll();
        const note = new PopupMenu.PopupMenuItem(
            'Logout and login if a reload says a different version is already loaded.');
        note.sensitive = false;
        this.menu.addMenuItem(note);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const manager = Main.extensionManager;
        const extensions = manager.getUuids()
            .map(uuid => manager.lookup(uuid))
            .filter(extension => extension?.metadata?.name)
            .sort((a, b) => {
                const state = a.state - b.state;
                if (state !== 0)
                    return state;
                return a.metadata.name.localeCompare(b.metadata.name);
            });

        for (const extension of extensions) {
            const state = STATE_TEXT[extension.state] ?? 'Unknown';
            const item = new PopupMenu.PopupMenuItem(`${state}    ${extension.metadata.name}`);
            if (extension.state === ExtensionState.ERROR ||
                extension.state === ExtensionState.OUT_OF_DATE)
                item.label.style = 'color: #e01b24; font-weight: bold;';
            item.connect('activate', () => {
                this.menu.close();
                reloadExtension(extension).catch(error => {
                    Main.notifyError('Reloading', `${extension.metadata.name}: ${error.message}`);
                });
            });
            this.menu.addMenuItem(item);
        }
    }
});

export default class ExtensionReloaderExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._signals = [];
        this._place();
        this._signals.push(this._settings.connect('changed::panel-icon-left', () => this._place()));
        this._signals.push(this._settings.connect('changed::panel-icon-center', () => this._place()));
    }

    disable() {
        for (const id of this._signals)
            this._settings.disconnect(id);
        this._signals = [];
        this._button?.destroy();
        this._button = null;
        this._settings = null;
    }

    _place() {
        this._button?.destroy();
        this._button = new ReloadMenu();
        const [position, box] = panelPosition(this._settings);
        Main.panel.addToStatusArea(ROLE, this._button, position, box);
    }
}

async function reloadExtension(extension) {
    const manager = Main.extensionManager;
    const {uuid} = extension;
    const name = extension.metadata.name;
    const stateBefore = extension.state;

    manager.enableExtension(uuid);
    await manager.reloadExtension(manager.lookup(uuid) ?? extension);

    const updated = manager.lookup(uuid);
    if (!updated) {
        Main.notifyError('Reloading', name);
        return;
    }
    if (updated.state === ExtensionState.ERROR || updated.state === ExtensionState.OUT_OF_DATE) {
        const detail = updated.error || STATE_TEXT[updated.state];
        if (String(detail).includes('log out'))
            Main.notify('Logout/Login', `${name}: ${detail}`);
        else
            Main.notifyError('Reloading', `${name}: ${detail}`);
        return;
    }
    if (stateBefore === ExtensionState.ERROR || updated.state === ExtensionState.ACTIVE)
        Main.notify('Reloading completed', name);
    else
        Main.notify('Reloading completed', `${name} (${STATE_TEXT[updated.state] ?? updated.state})`);
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
