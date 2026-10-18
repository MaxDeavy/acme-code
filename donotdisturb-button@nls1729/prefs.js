/*
  Do Not Disturb Button Gnome Shell Extension

  Copyright (c) 2015-2020 Norman L. Smith
  Ported to GNOME Shell 51 in 2026.

  SPDX-License-Identifier: GPL-2.0-or-later
*/

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class DoNotDisturbPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: _('Do Not Disturb'),
            icon_name: 'notifications-disabled-symbolic',
        });
        window.add(page);

        const place = new Adw.PreferencesGroup({title: _('Button')});
        page.add(place);
        place.add(positionRow(settings));
        place.add(switchRow(settings, _('Show notification count'), 'panel-count-show'));
        place.add(shortcutRow(settings, window));

        const startup = new Adw.PreferencesGroup({title: _('Session start')});
        page.add(startup);
        startup.add(switchRow(settings, _('Set state when the session starts'), 'override'));
        startup.add(switchRow(settings, _('Start busy'), 'overrride-busy-state'));

        const timeout = new Adw.PreferencesGroup({
            title: _('Busy timeout'),
            description: _('Leave busy mode after the chosen interval.'),
        });
        page.add(timeout);
        timeout.add(switchRow(settings, _('Timeout enabled'), 'time-out-enabled'));
        timeout.add(switchRow(settings, _('Repeat whenever busy mode starts'), 'time-out-always'));
        const hours = intSpin(settings, _('Hours'), 'time-out-hours', 0, 23, 1);
        const minutes = intSpin(settings, _('Minutes'), 'time-out-minutes', 0, 59, 1);
        const updateInterval = () => {
            const total = settings.get_int('time-out-hours') * 60 + settings.get_int('time-out-minutes');
            settings.set_int('time-out-interval', total);
        };
        hours.connect('notify::value', updateInterval);
        minutes.connect('notify::value', updateInterval);
        timeout.add(hours);
        timeout.add(minutes);

        const sound = new Adw.PreferencesGroup({title: _('Sound')});
        page.add(sound);
        sound.add(switchRow(settings, _('Mute while busy'), 'mute-busy'));
        sound.add(switchRow(settings, _('Unmute when available'), 'unmute-available'));

        const icons = new Adw.PreferencesGroup({
            title: _('Icons'),
            description: _('Leave a path empty to use the built-in icon. "default" does the same.'),
        });
        page.add(icons);
        icons.add(pathRow(settings, _('Available icon'), 'available-icon'));
        icons.add(pathRow(settings, _('Busy icon'), 'busy-icon'));
    }
}

function pathRow(settings, title, key) {
    const current = settings.get_string(key);
    const row = new Adw.EntryRow({
        title,
        text: current === 'default' ? '' : current,
    });
    row.connect('apply', () => {
        const text = row.text.trim();
        settings.set_string(key, text || 'default');
        settings.set_boolean('reset-icon', !settings.get_boolean('reset-icon'));
    });
    return row;
}

function switchRow(settings, title, key) {
    const row = new Adw.SwitchRow({title});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function intSpin(settings, title, key, lower, upper, step) {
    const row = new Adw.SpinRow({
        title,
        adjustment: new Gtk.Adjustment({
            lower,
            upper,
            step_increment: step,
            page_increment: 10,
            value: settings.get_int(key),
        }),
        digits: 0,
    });
    row.connect('notify::value', () => {
        const next = Math.round(row.value);
        if (settings.get_int(key) !== next)
            settings.set_int(key, next);
    });
    return row;
}

function positionRow(settings) {
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
    return row;
}

function shortcutRow(settings, parent) {
    const row = new Adw.ActionRow({title: _('Toggle shortcut')});
    const label = new Gtk.ShortcutLabel({
        accelerator: settings.get_strv('shortcut')[0] ?? '',
        valign: Gtk.Align.CENTER,
    });
    const button = new Gtk.Button({
        label: _('Set'),
        valign: Gtk.Align.CENTER,
    });
    button.connect('clicked', () => captureShortcut(parent, accelerator => {
        settings.set_strv('shortcut', accelerator ? [accelerator] : []);
        label.accelerator = accelerator ?? '';
    }));
    row.add_suffix(label);
    row.add_suffix(button);
    row.activatable_widget = button;
    return row;
}

function captureShortcut(parent, done) {
    const dialog = new Adw.Dialog({
        title: _('Shortcut'),
        content_width: 360,
    });
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        margin_top: 24,
        margin_bottom: 24,
        margin_start: 24,
        margin_end: 24,
    });
    box.append(new Gtk.Label({
        label: _('Press a shortcut. Escape cancels, Backspace clears.'),
        wrap: true,
    }));
    const controller = new Gtk.EventControllerKey();
    controller.connect('key-pressed', (_controller, keyval, _keycode, state) => {
        if (keyval === Gdk.KEY_Escape) {
            dialog.close();
            return Gdk.EVENT_STOP;
        }
        if (keyval === Gdk.KEY_BackSpace) {
            done('');
            dialog.close();
            return Gdk.EVENT_STOP;
        }
        const mask = state & Gtk.accelerator_get_default_mod_mask();
        const loneModifier = mask === 0 && (
            keyval === Gdk.KEY_Control_L || keyval === Gdk.KEY_Control_R ||
            keyval === Gdk.KEY_Shift_L || keyval === Gdk.KEY_Shift_R ||
            keyval === Gdk.KEY_Alt_L || keyval === Gdk.KEY_Alt_R ||
            keyval === Gdk.KEY_Super_L || keyval === Gdk.KEY_Super_R);
        if (loneModifier)
            return Gdk.EVENT_PROPAGATE;
        done(Gtk.accelerator_name(keyval, mask));
        dialog.close();
        return Gdk.EVENT_STOP;
    });
    box.add_controller(controller);
    dialog.set_child(box);
    dialog.present(parent);
}
