'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Exercise the actual scripts referenced by the page, in their load order.
module.exports = function loadWebSource(filename = 'index.html') {
  const root = path.resolve(__dirname, '..');
  const page = fs.readFileSync(path.join(root, filename), 'utf8');
  return page.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (tag, attrs) => {
    const src = attrs.match(/\bsrc=["']([^"']+)["']/);
    if (!src || /^(?:https?:)?\/\//.test(src[1])) return tag;
    return `<script>${fs.readFileSync(path.join(root, src[1]), 'utf8')}</script>`;
  });
};
