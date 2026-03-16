/**
 * Enhanced DOM dump — captures the agent panel as a detailed tree.
 * Uses string-based page.evaluate to avoid tsx __name decorator issues.
 *
 * Usage: cd ~/Coacker && npx tsx packages/cli/tests/dump-dom.ts
 */

import { Antigravity } from '../../backend/src/ag/client.js';
import { loadConfig, getBackendConfig } from '@coacker/shared';
import { writeFileSync } from 'node:fs';

async function main() {
  const cfg = loadConfig();
  const backendCfg = getBackendConfig(cfg);

  const ag = new Antigravity({
    endpointUrl: backendCfg.ag?.endpointUrl,
    timeout: backendCfg.ag?.timeout,
    humanize: false,
  });

  const title = await ag.connect(backendCfg.ag?.windowTitle);
  console.log('Connected to:', title);
  const page = ag.page;

  // ─── 1. Full panel tree (depth ≤ 12) ───
  const tree = await page.evaluate(`
    (function() {
      var panel = document.querySelector('.antigravity-agent-side-panel')
        || document.querySelector('.part.auxiliarybar');
      if (!panel) return 'No panel found';

      function walk(el, depth) {
        if (depth > 12) return '';
        var indent = '  '.repeat(depth);
        var tag = el.tagName.toLowerCase();
        var clsList = String(el.className || '').split(/\\s+/).filter(function(c) { return c.length > 0; });
        var cls = clsList.length > 0 ? '.' + clsList.slice(0, 6).join('.') : '';
        var kids = el.children.length;
        var textLen = el.innerText ? el.innerText.length : 0;

        var directText = '';
        if (el.childNodes.length > 0 && el.childNodes[0].nodeType === 3) {
          var t = (el.childNodes[0].textContent || '').trim();
          if (t.length > 0) directText = ' text="' + t.slice(0, 60).replace(/\\n/g, '\\\\n') + '"';
        }

        var isLR = el.classList.contains('leading-relaxed');
        var hasOpacity = String(el.className).includes('opacity-70');
        var marker = isLR ? (hasOpacity ? ' ★THINKING' : ' ★MSG') : '';

        var line = indent + '<' + tag + cls + '> [kids:' + kids + ', text:' + textLen + ']' + directText + marker;

        if (kids === 0) return line;
        var childLines = [];
        var limit = Math.min(kids, 30);
        for (var i = 0; i < limit; i++) {
          var c = walk(el.children[i], depth + 1);
          if (c) childLines.push(c);
        }
        if (kids > 30) childLines.push(indent + '  ... ' + (kids - 30) + ' more children');
        return [line].concat(childLines).join('\\n');
      }

      return walk(panel, 0);
    })()
  `);
  writeFileSync('/tmp/dom-tree.txt', String(tree));
  console.log('Full tree → /tmp/dom-tree.txt (' + String(tree).length + ' chars)');

  // ─── 2. Chat scroll area (focused tree) ───
  const chatArea = await page.evaluate(`
    (function() {
      var panel = document.querySelector('.antigravity-agent-side-panel')
        || document.querySelector('.part.auxiliarybar');
      if (!panel) return 'No panel found';

      // Find scroll area: deepest common ancestor of .leading-relaxed containers
      var msgs = panel.querySelectorAll('.leading-relaxed');
      var scrollEl = null;
      if (msgs.length > 1) {
        var common = msgs[0].parentElement;
        while (common) {
          if (common.contains(msgs[msgs.length - 1])) break;
          common = common.parentElement;
        }
        scrollEl = common;
      } else if (msgs.length === 1) {
        scrollEl = msgs[0].parentElement ? msgs[0].parentElement.parentElement : null;
      }
      if (!scrollEl) return 'No scroll area found';

      function walk(el, depth) {
        if (depth > 15) return '';
        var indent = '  '.repeat(depth);
        var tag = el.tagName.toLowerCase();
        var clsList = String(el.className || '').split(/\\s+/).filter(function(c) { return c.length > 0; });
        var cls = clsList.length > 0 ? '.' + clsList.slice(0, 10).join('.') : '';
        var kids = el.children.length;
        var textLen = el.innerText ? el.innerText.length : 0;

        var ownText = '';
        for (var n = 0; n < el.childNodes.length; n++) {
          if (el.childNodes[n].nodeType === 3) {
            var t = (el.childNodes[n].textContent || '').trim();
            if (t.length > 0) {
              ownText = ' own="' + t.slice(0, 80).replace(/\\n/g, '\\\\n') + '"';
              break;
            }
          }
        }

        var isLR = el.classList.contains('leading-relaxed');
        var hasOpacity = String(el.className).includes('opacity-70');
        var hasBotColor = String(el.className).includes('bot-color');
        var hasUserColor = String(el.className).includes('user-color');
        var marker = '';
        if (isLR) marker = hasOpacity ? ' ★THINKING' : ' ★MSG';
        if (hasBotColor) marker += ' ★BOT';
        if (hasUserColor) marker += ' ★USER';

        var line = indent + '<' + tag + cls + '> [kids:' + kids + ', text:' + textLen + ']' + ownText + marker;

        if (kids === 0 || depth > 14) return line;
        var childLines = [];
        var limit = Math.min(kids, 50);
        for (var i = 0; i < limit; i++) {
          var c = walk(el.children[i], depth + 1);
          if (c) childLines.push(c);
        }
        if (kids > 50) childLines.push(indent + '  ... ' + (kids - 50) + ' more children');
        return [line].concat(childLines).join('\\n');
      }

      return walk(scrollEl, 0);
    })()
  `);
  writeFileSync('/tmp/dom-chat-area.txt', String(chatArea));
  console.log('Chat area → /tmp/dom-chat-area.txt (' + String(chatArea).length + ' chars)');

  // ─── 3. Structured message analysis ───
  const messages = await page.evaluate(`
    (function() {
      var panel = document.querySelector('.antigravity-agent-side-panel')
        || document.querySelector('.part.auxiliarybar');
      if (!panel) return [];

      var containers = panel.querySelectorAll('.leading-relaxed');
      var results = [];
      for (var i = 0; i < containers.length; i++) {
        var el = containers[i];
        var classes = String(el.className);
        var hasOpacity = classes.indexOf('opacity-70') >= 0;
        var hasTextColor = classes.indexOf('text-ide-text-color') >= 0;

        var parent = el.parentElement;
        var gp = parent ? parent.parentElement : null;

        // Siblings analysis
        var siblings = [];
        if (parent) {
          for (var s = 0; s < parent.children.length; s++) {
            var sib = parent.children[s];
            siblings.push({
              tag: sib.tagName,
              classes: String(sib.className || '').split(/\\s+/).slice(0, 5).join(' '),
              textLen: sib.innerText ? sib.innerText.length : 0,
              textPreview: (sib.innerText || '').slice(0, 100).replace(/\\n/g, '\\\\n'),
              isSelf: sib === el
            });
          }
        }

        results.push({
          index: i,
          textLen: el.innerText ? el.innerText.length : 0,
          textPreview: (el.innerText || '').slice(0, 200).replace(/\\n/g, '\\\\n'),
          isThinking: hasOpacity,
          isResponse: hasTextColor,
          parentTag: parent ? parent.tagName : '',
          parentClasses: parent ? String(parent.className || '').split(/\\s+/).slice(0, 8).join(' ') : '',
          gpTag: gp ? gp.tagName : '',
          gpClasses: gp ? String(gp.className || '').split(/\\s+/).slice(0, 8).join(' ') : '',
          siblings: siblings
        });
      }
      return results;
    })()
  `);
  writeFileSync('/tmp/dom-messages.json', JSON.stringify(messages, null, 2));
  console.log('Messages: ' + messages.length + ' .leading-relaxed → /tmp/dom-messages.json');

  // ─── 4. Non-.leading-relaxed content blocks ───
  const extraBlocks = await page.evaluate(`
    (function() {
      var panel = document.querySelector('.antigravity-agent-side-panel')
        || document.querySelector('.part.auxiliarybar');
      if (!panel) return [];

      var selectors = [
        '[class*="message-block"]',
        '[class*="bot-color"]',
        '[class*="user-color"]',
        '[class*="file-edit"]',
        '[class*="progress"]',
        '[class*="task-"]',
        'details',
        'summary'
      ];

      var results = [];
      for (var si = 0; si < selectors.length; si++) {
        var sel = selectors[si];
        try {
          var els = panel.querySelectorAll(sel);
          var limit = Math.min(els.length, 15);
          for (var i = 0; i < limit; i++) {
            var el = els[i];
            var insideLR = el.closest('.leading-relaxed') !== null;
            results.push({
              selector: sel,
              tag: el.tagName,
              classes: String(el.className || '').split(/\\s+/).slice(0, 8).join(' '),
              insideLeadingRelaxed: insideLR,
              textLen: el.innerText ? el.innerText.length : 0,
              textPreview: (el.innerText || '').slice(0, 150).replace(/\\n/g, '\\\\n')
            });
          }
        } catch(e) { /* skip */ }
      }
      return results;
    })()
  `);
  writeFileSync('/tmp/dom-extra-blocks.json', JSON.stringify(extraBlocks, null, 2));
  console.log('Extra blocks: ' + extraBlocks.length + ' → /tmp/dom-extra-blocks.json');

  await ag.disconnect();
  console.log('\\nDone! Check /tmp/dom-*.{txt,json}');
}

main().catch(console.error);
