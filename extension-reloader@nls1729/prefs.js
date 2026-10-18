/*
  Gnome Shell Extension Reloader

  Copyright (c) 2016-2018 Norman L. Smith
  Ported to GNOME Shell 51 in 2026.

  SPDX-License-Identifier: GPL-2.0-or-later
*/

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ExtensionReloaderPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: _('Reloader'),
            icon_name: 'view-refresh-symbolic',
        });
        const group = new Adw.PreferencesGroup({
            title: _('Button location'),
            description: _('GNOME Shell 51 runs on Wayland. Reloading the same extension version works in the session. A changed version still needs a logout.'),
        });
        page.add(group);

        const options = [
            [_('Left'), false, true],
            [_('Center, left side'), true, true],
            [_('Center, right side'), true, false],
            [_('Right'), false, false],
        ];
        const current = options.findIndex(([, center, left]) =>
            settings.get_boolean('panel-icon-center') === center &&
            settings.get_boolean('panel-icon-left') === left);
        const row = new Adw.ComboRow({
            title: _('Button location'),
            model: new Gtk.StringList({strings: options.map(([label]) => label)}),
            selected: Math.max(0, current),
        });
        row.connect('notify::selected', () => {
            const [, center, left] = options[row.selected];
            settings.set_boolean('panel-icon-center', center);
            settings.set_boolean('panel-icon-left', left);
        });
        group.add(row);
        window.add(page);
    }
}
