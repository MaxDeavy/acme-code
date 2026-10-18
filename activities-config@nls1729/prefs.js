/*
  Activities Configurator Gnome Shell Extension

  Copyright (c) 2012-2020 Norman L. Smith
  Ported to GNOME Shell 51 in 2026.

  SPDX-License-Identifier: GPL-2.0-or-later
*/

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import * as Keys from './keys.js';

export default class ActivitiesConfigPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.add(this._buttonPage(settings, window));
        window.add(this._hotCornerPage(settings));
        window.add(this._panelPage(settings));
        window.add(this._windowPage(settings));
    }

    _buttonPage(settings, window) {
        const page = new Adw.PreferencesPage({
            title: _('Button'),
            icon_name: 'start-here-symbolic',
        });

        const icon = new Adw.PreferencesGroup({title: _('Icon')});
        page.add(icon);
        icon.add(iconRow(settings, window));
        icon.add(doubleSpin(settings, _('Scale Icon'), Keys.SCF_ICO, 0.5, 3, 0.1));
        icon.add(switchRow(settings, _('Hide Icon'), null, Keys.NO_ICON));
        icon.add(intSpin(settings, _('Icon Padding'), Keys.PAD_ICO, 0, 24, 1));

        const text = new Adw.PreferencesGroup({title: _('Text')});
        page.add(text);
        const entry = new Adw.EntryRow({title: _('New Text')});
        settings.bind(Keys.NEW_TXT, entry, 'text', Gio.SettingsBindFlags.DEFAULT);
        text.add(entry);
        text.add(switchRow(settings, _('Hide Text'), null, Keys.NO_TEXT));
        text.add(intSpin(settings, _('Text Padding'), Keys.PAD_TXT, 0, 24, 1));

        const place = new Adw.PreferencesGroup({title: _('Placement')});
        page.add(place);
        place.add(switchRow(settings, _('Remove Activities Button'), null, Keys.REMOVED));
        place.add(switchRow(settings, _('Move Activities to the Right'), null, Keys.BTN_POSITION));
        place.add(switchRow(
            settings,
            _('Enable Conflict Detection'),
            _('Keep the button at the far left of the panel.'),
            Keys.CON_DET));
        place.add(switchRow(settings, _('Disable Enable Delay'), null, Keys.DISABLE_ENABLE_DELAY));
        return page;
    }

    _hotCornerPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Hot Corner'),
            icon_name: 'input-mouse-symbolic',
        });
        const group = new Adw.PreferencesGroup();
        page.add(group);
        group.add(switchRow(settings, _('Disable Hot Corner'), null, Keys.NO_HOTC));
        group.add(intSpin(settings, _('Hot Corner Threshold'), Keys.HOTC_PT, 1, 1000, 10));
        group.add(intSpin(settings, _('Hot Corner Delay'), Keys.HOTC_TO, 0, 5000, 50));
        group.add(switchRow(
            settings,
            _('Show Overview If No Applications Are Running'),
            null,
            Keys.SHOW_OVERVIEW));
        return page;
    }

    _panelPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Panel'),
            icon_name: 'preferences-desktop-display-symbolic',
        });
        const background = new Adw.PreferencesGroup({title: _('Background')});
        page.add(background);
        background.add(switchRow(
            settings,
            _('Set Panel Background'),
            _('Apply the color below even when a Shell theme is active.'),
            Keys.OVERR_THEME));
        background.add(colorRow(settings, _('Panel Color'), Keys.COLOURS));
        background.add(intSpin(settings, _('Panel Transparency'), Keys.TRS_PAN, 0, 100, 1));

        const shadow = new Adw.PreferencesGroup({title: _('Shadow')});
        page.add(shadow);
        shadow.add(colorRow(settings, _('Panel Shadow Color'), Keys.SHADOW_COLOR));
        shadow.add(intSpin(settings, _('Transparency'), Keys.SHADOW_TRANS, 0, 100, 1));
        shadow.add(intSpin(settings, _('Vertical Length'), Keys.SHADOW_LEN, 0, 64, 1));
        shadow.add(intSpin(settings, _('Blur Radius'), Keys.SHADOW_BLUR, 0, 64, 1));
        shadow.add(intSpin(settings, _('Spread Radius'), Keys.SHADOW_SPRED, 0, 64, 1));
        return page;
    }

    _windowPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Windows'),
            icon_name: 'window-maximize-symbolic',
        });
        const group = new Adw.PreferencesGroup({
            title: _('Window Maximized Effect'),
            description: _('Changes the panel while a window on the primary display is maximized or tiled.'),
        });
        page.add(group);

        const effect = new Adw.ComboRow({
            title: _('Window Maximized Effect'),
            model: new Gtk.StringList({
                strings: [_('None'), _('Remove transparency'), _('Opaque black')],
            }),
            selected: settings.get_int(Keys.MAX_WIN_EFFECT),
        });
        effect.connect('notify::selected', () => {
            if (settings.get_int(Keys.MAX_WIN_EFFECT) !== effect.selected)
                settings.set_int(Keys.MAX_WIN_EFFECT, effect.selected);
        });
        settings.connect(`changed::${Keys.MAX_WIN_EFFECT}`, () => {
            if (effect.selected !== settings.get_int(Keys.MAX_WIN_EFFECT))
                effect.selected = settings.get_int(Keys.MAX_WIN_EFFECT);
        });
        group.add(effect);
        group.add(switchRow(
            settings,
            _('Ignore tiled windows'),
            _('Only fully maximized windows change the panel.'),
            Keys.TILE_OFF));
        return page;
    }
}

function switchRow(settings, title, subtitle, key) {
    const row = new Adw.SwitchRow({title, subtitle: subtitle ?? ''});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function intSpin(settings, title, key, lower, upper, step) {
    return spin(settings, title, key, lower, upper, step, true);
}

function doubleSpin(settings, title, key, lower, upper, step) {
    return spin(settings, title, key, lower, upper, step, false);
}

function spin(settings, title, key, lower, upper, step, integer) {
    const read = () => integer ? settings.get_int(key) : settings.get_double(key);
    const write = value => {
        if (integer)
            settings.set_int(key, value);
        else
            settings.set_double(key, value);
    };
    const row = new Adw.SpinRow({
        title,
        adjustment: new Gtk.Adjustment({
            lower,
            upper,
            step_increment: step,
            page_increment: step * 10,
            value: read(),
        }),
        digits: integer ? 0 : 1,
    });
    row.connect('notify::value', () => {
        const next = integer ? Math.round(row.value) : row.value;
        if (read() !== next)
            write(next);
    });
    settings.connect(`changed::${key}`, () => {
        if (read() !== row.value)
            row.value = read();
    });
    return row;
}

function colorRow(settings, title, key) {
    const row = new Adw.ActionRow({title});
    const button = new Gtk.ColorButton({valign: Gtk.Align.CENTER});
    const rgba = new Gdk.RGBA();
    rgba.parse(settings.get_string(key));
    button.set_rgba(rgba);
    button.connect('color-set', () => {
        settings.set_string(key, hexColor(button.get_rgba()));
    });
    settings.connect(`changed::${key}`, () => {
        const next = new Gdk.RGBA();
        if (next.parse(settings.get_string(key)))
            button.set_rgba(next);
    });
    row.add_suffix(button);
    return row;
}

function iconRow(settings, window) {
    const row = new Adw.ActionRow({
        title: _('Select Icon'),
        subtitle: settings.get_string(Keys.NEW_ICO),
    });
    const button = new Gtk.Button({
        label: _('Select'),
        valign: Gtk.Align.CENTER,
    });
    button.connect('clicked', () => {
        const dialog = new Gtk.FileDialog({title: _('Select Icon')});
        const filter = new Gtk.FileFilter();
        filter.add_pixbuf_formats();
        filter.add_pattern('*.svg');
        dialog.set_default_filter(filter);
        dialog.open(window, null, (_source, result) => {
            try {
                const file = dialog.open_finish(result);
                settings.set_string(Keys.NEW_ICO, file.get_path());
            } catch (error) {
                if (!error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.error(error);
            }
        });
    });
    settings.connect(`changed::${Keys.NEW_ICO}`, () => {
        row.subtitle = settings.get_string(Keys.NEW_ICO);
    });
    row.add_suffix(button);
    return row;
}

function hexColor(rgba) {
    const channel = value => Math.round(value * 255).toString(16).padStart(2, '0');
    return `#${channel(rgba.red)}${channel(rgba.green)}${channel(rgba.blue)}`;
}
