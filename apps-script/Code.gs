/**
 * FirstLine Sender Sheet
 *
 * Sends your FirstLine campaign from this Gmail account, one email at a time,
 * inside the sending window you set in FirstLine. Every 5 minutes it:
 *   1. checks the threads of emails it sent for replies and bounces,
 *   2. asks FirstLine for at most one email and sends it,
 *   3. reports back. Only status flags (sent / replied / bounced / asked to stop)
 *      go to FirstLine, never the text of anyone's email.
 *
 * Tick "Pause sending" on the FirstLine tab to stop everything at once.
 * Setup: see apps-script/README.md in the FirstLine repository.
 */

var FL_VERSION = '1.0.0';
// Filled in by FirstLine's "Copy the script" button, so Connect only asks for the key.
var FL_DEFAULT_BASE = '';
var CONTROL_SHEET = 'FirstLine';
var LOG_SHEET = 'Log';
var PAUSE_CELL = 'B4';
var MAX_LOG_ROWS = 2000;

// ---- Menu -------------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('FirstLine')
    .addItem('Connect…', 'flConnect')
    .addItem('Run now', 'flRun')
    .addItem('Disconnect', 'flDisconnect')
    .addToUi();
}

function flConnect() {
  var ui = SpreadsheetApp.getUi();
  var base = FL_DEFAULT_BASE;
  if (!base) {
    var urlAnswer = ui.prompt('Connect to FirstLine (1 of 2)', 'Paste the FirstLine address from the Inboxes page (it starts with https://).', ui.ButtonSet.OK_CANCEL);
    if (urlAnswer.getSelectedButton() !== ui.Button.OK) return;
    base = urlAnswer.getResponseText();
  }
  base = base.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s]+$/.test(base)) {
    ui.alert('That doesn\'t look like an https:// address. Copy it from FirstLine → Inboxes and try again.');
    return;
  }

  var keyAnswer = ui.prompt(FL_DEFAULT_BASE ? 'Connect to FirstLine' : 'Connect to FirstLine (2 of 2)', 'Paste the sender key for this inbox (it starts with fl_).', ui.ButtonSet.OK_CANCEL);
  if (keyAnswer.getSelectedButton() !== ui.Button.OK) return;
  var key = keyAnswer.getResponseText().trim();
  if (!/^fl_[A-Za-z0-9_-]{40,}$/.test(key)) {
    ui.alert('That doesn\'t look like a FirstLine sender key. Copy it from FirstLine → Inboxes and try again.');
    return;
  }

  var cfg = { base: base, key: key };
  var res;
  try {
    res = flFetch_(cfg, 'get', '/api/sender/next', null, true);
  } catch (e) {
    ui.alert('Couldn\'t connect: ' + e.message);
    return;
  }
  PropertiesService.getUserProperties().setProperties({ FL_BASE: base, FL_KEY: key });

  // One trigger, every 5 minutes.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'flRun') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('flRun').timeBased().everyMinutes(5).create();

  flEnsureSheets_();
  flShowStatus_(res, 'Connected');
  flLog_('Connected', res.inbox.email, 'Script ' + FL_VERSION);

  var me = Session.getEffectiveUser().getEmail().toLowerCase();
  var warning = me && me !== res.inbox.email.toLowerCase()
    ? '\n\nHeads-up: this Google account is ' + me + ', but the FirstLine inbox is ' + res.inbox.email + '. Emails will go out from ' + me + '.'
    : '';
  ui.alert('Connected', 'FirstLine will send from this Gmail account every few minutes, inside your sending window.\n\nToday: ' +
    res.inbox.sent_today + ' of ' + res.inbox.cap + ' sent. Status: ' + (res.wait ? res.wait.label : 'Ready') + '.' + warning, ui.ButtonSet.OK);
}

function flDisconnect() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'flRun') ScriptApp.deleteTrigger(t);
  });
  PropertiesService.getUserProperties().deleteProperty('FL_KEY');
  flEnsureSheets_();
  flSet_('B3', 'Disconnected');
  flLog_('Disconnected', '', '');
}

// ---- The 5-minute run -------------------------------------------------------------------

function flRun() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // the previous run is still busy
  try {
    var props = PropertiesService.getUserProperties();
    var cfg = { base: props.getProperty('FL_BASE'), key: props.getProperty('FL_KEY') };
    if (!cfg.base || !cfg.key) return;
    flEnsureSheets_();

    var paused = flPaused_();
    // Paused: still send the heartbeat and look for replies, but take no new email.
    var res = flFetch_(cfg, 'get', '/api/sender/next', null, paused);
    if (res.script.update_required) flLog_('Update needed', '', 'Copy the latest Code.gs from FirstLine. Sending is paused until then.');

    var report = {};
    var events = flCheckThreads_(res.watch || [], res.rules);
    if (events.length) report.events = events;

    if (res.email && !paused) {
      try {
        var threadId = flSend_(res.email);
        report.send = { send_id: res.email.send_id, status: 'sent', thread_id: threadId };
        flLog_('Sent', res.email.to, res.email.subject);
      } catch (e) {
        report.send = { send_id: res.email.send_id, status: 'failed', error: String(e && e.message || e) };
        flLog_('Send failed', res.email.to, String(e && e.message || e));
      }
    }

    if (report.send || report.events) flFetch_(cfg, 'post', '/api/sender/report', report, false);

    var sentNow = report.send && report.send.status === 'sent' ? 1 : 0;
    res.inbox.sent_today += sentNow;
    flShowStatus_(res, paused ? 'Paused (untick ' + PAUSE_CELL + ' to resume)' : sentNow ? 'Sent 1 email' : res.wait ? res.wait.label : 'Ready');
  } catch (e) {
    flLog_('Error', '', String(e && e.message || e));
    flSet_('B3', 'Error: ' + String(e && e.message || e));
  } finally {
    lock.releaseLock();
  }
}

function flSend_(email) {
  if (email.thread_id) throw new Error('Follow-ups in the same thread need a newer script version.');
  var draft = GmailApp.createDraft(email.to, email.subject, email.body);
  var message = draft.send();
  return message.getThread().getId();
}

/** Replies and bounces in the threads FirstLine asked about. Only flags leave this function. */
function flCheckThreads_(watch, rules) {
  var me = Session.getEffectiveUser().getEmail().toLowerCase();
  var unsubscribe = new RegExp(rules.unsubscribe, 'im');
  var cut = new RegExp(rules.reply_cut, 'im');
  var bounceFrom = new RegExp(rules.bounce_from, 'i');
  var events = [];
  watch.forEach(function (w) {
    var thread;
    try {
      thread = GmailApp.getThreadById(w.thread_id);
    } catch (e) {
      return; // deleted or no access: skip quietly
    }
    if (!thread) return;
    var messages = thread.getMessages();
    for (var i = 1; i < messages.length; i++) { // messages[0] is the email we sent
      var from = messages[i].getFrom().toLowerCase();
      if (bounceFrom.test(from)) {
        events.push({ send_id: w.send_id, type: 'bounced' });
        flLog_('Bounced', w.thread_id, '');
        return;
      }
      if (me && from.indexOf(me) === -1) {
        var stop = unsubscribe.test(flOwnText_(messages[i].getPlainBody(), cut));
        events.push({ send_id: w.send_id, type: 'replied', unsubscribe: stop });
        flLog_(stop ? 'Replied: asked to stop' : 'Replied', from, '');
        return;
      }
    }
  });
  return events;
}

/** The reply's own words: drop the quoted email and "> " lines (same rule as FirstLine's server). */
function flOwnText_(body, cut) {
  var at = body.search(cut);
  var own = at >= 0 ? body.slice(0, at) : body;
  return own.split('\n').filter(function (l) { return l.replace(/^\s+/, '').charAt(0) !== '>'; }).join('\n').trim().slice(0, 1000);
}

// ---- HTTP -------------------------------------------------------------------------------

function flFetch_(cfg, method, path, payload, peek) {
  var options = {
    method: method,
    muteHttpExceptions: true,
    headers: { 'X-FirstLine-Key': cfg.key, 'X-FirstLine-Script': FL_VERSION, 'X-FirstLine-Peek': peek ? '1' : '0' },
  };
  if (payload) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }
  var resp = UrlFetchApp.fetch(cfg.base + path, options);
  var code = resp.getResponseCode();
  var body;
  try {
    body = JSON.parse(resp.getContentText());
  } catch (e) {
    throw new Error('FirstLine answered with HTTP ' + code + ' and no JSON. Is the address right?');
  }
  if (code >= 400) throw new Error(body.error || 'HTTP ' + code);
  return body;
}

// ---- Sheet ------------------------------------------------------------------------------

function flEnsureSheets_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var control = ss.getSheetByName(CONTROL_SHEET);
  if (!control) {
    control = ss.insertSheet(CONTROL_SHEET, 0);
    control.getRange('A1').setValue('FirstLine Sender').setFontSize(14).setFontWeight('bold');
    control.getRange('A3:A8').setValues([['Status'], ['Pause sending'], ['Inbox'], ['Sent today'], ['Last run'], ['Script version']]).setFontWeight('bold');
    control.getRange(PAUSE_CELL).insertCheckboxes();
    control.getRange('A10').setValue('Tick "Pause sending" to stop at once. Replies are still detected while paused.').setFontColor('#64748b');
    control.setColumnWidth(1, 140);
    control.setColumnWidth(2, 420);
  }
  var log = ss.getSheetByName(LOG_SHEET);
  if (!log) {
    log = ss.insertSheet(LOG_SHEET);
    log.appendRow(['Time', 'Event', 'Who', 'Detail']);
    log.getRange('A1:D1').setFontWeight('bold');
    log.setFrozenRows(1);
  }
}

function flPaused_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONTROL_SHEET);
  return !!(sheet && sheet.getRange(PAUSE_CELL).getValue() === true);
}

function flShowStatus_(res, status) {
  flSet_('B3', status);
  flSet_('B5', res.inbox.email);
  flSet_('B6', res.inbox.sent_today + ' of ' + res.inbox.cap);
  flSet_('B7', new Date());
  flSet_('B8', FL_VERSION + (res.script.latest !== FL_VERSION ? '  (newer version available: ' + res.script.latest + ')' : ''));
}

function flSet_(cell, value) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONTROL_SHEET);
  if (sheet) sheet.getRange(cell).setValue(value);
}

function flLog_(event, who, detail) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET);
  if (!sheet) return;
  sheet.appendRow([new Date(), event, who, detail]);
  var extra = sheet.getLastRow() - 1 - MAX_LOG_ROWS;
  if (extra > 0) sheet.deleteRows(2, extra);
}
