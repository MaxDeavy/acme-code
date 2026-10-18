/*
  Activities Configurator Gnome Shell Extension
  Copyright (c) 2012-2020 Norman L. Smith
  SPDX-License-Identifier: GPL-2.0-or-later
*/

export function getColorRGB(hexString) {
    const hex = hexString?.startsWith('#') ? hexString : '#000000';
    return {
        red: parseInt(hex.slice(1, 3), 16) || 0,
        green: parseInt(hex.slice(3, 5), 16) || 0,
        blue: parseInt(hex.slice(5, 7), 16) || 0,
    };
}

export function getColorStringCSS(color) {
    return `${color.red},${color.green},${color.blue}`;
}
