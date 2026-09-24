'use strict';

/**
 * Accounts for the dashboard.
 *
 *   node tools/user.js super krish        make an account a superadmin: the only way to create the first
 *   node tools/user.js add krish          add or replace an admin account, asking for the password
 *   node tools/user.js add krish hunter2  same, password on the command line (it lands in your shell history)
 *   node tools/user.js demote krish       put a superadmin back to admin
 *   node tools/user.js word reader        set the shared reader word (asks for it); also: word viewer
 *   node tools/user.js word reader off    take that shared word out of use
 *   node tools/user.js list               who has an account, and what the shared words are
 *   node tools/user.js remove krish       take an account away
 *   node tools/user.js export             users.json on one line, to paste into the host's UNISIS_USERS
 *   node tools/user.js google <id>        set the Google client id (sign-in with Google turns on)
 *   node tools/user.js allow <email>      let that address in; @a-domain.com lets everyone there in
 *   node tools/user.js deny <email>       take it off the list
 *   node tools/user.js config             what Google sign-in is set to
 *
 * Accounts live in users.json next to server.js. Keep that file off git: it holds the
 * password hashes, and anyone with it can try passwords against them offline.
 */

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const auth = require('../auth.js');

const [cmd, name, passwordArg] = process.argv.slice(2);
const ROLE_NOTE = 'Roles: superadmin runs the console at /admin, admin opens the dashboard,\n'
  + 'reader and viewer share one access word each.';

function askPassword(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Hide the typing: the prompt is written once, keystrokes are not echoed back.
    const onData = () => rl.output.write(`\x1b[2K\r${prompt}`);
    rl.input.on('data', onData);
    rl.question(prompt, (answer) => {
      rl.input.off('data', onData);
      rl.output.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

(async () => {
  if (cmd === 'add') {
    if (!name) return fail('Which account? e.g. node tools/user.js add krish');
    const password = passwordArg || (await askPassword(`Password for ${name}: `));
    if (password.length < 8) return fail('Use at least 8 characters.');
    auth.addUser(name, password, 'admin');
    console.log(`${name} can now sign in as an admin.`);
    return;
  }
  if (cmd === 'super' || cmd === 'demote') {
    if (!name) return fail(`Which account? e.g. node tools/user.js ${cmd} krish`);
    const role = cmd === 'super' ? 'superadmin' : 'admin';
    try {
      if (!auth.setRole(name, role)) return fail(`No account called ${name}. Add one first: node tools/user.js add ${name}`);
    } catch (err) {
      return fail(err.message);
    }
    console.log(cmd === 'super' ? `${name} is a superadmin and can manage access at /admin.` : `${name} is an admin again.`);
    return;
  }
  if (cmd === 'word') {
    if (!auth.SHARED.includes(name)) return fail('Which word? node tools/user.js word reader   (or: word viewer)');
    if (String(passwordArg).toLowerCase() === 'off') {
      auth.setWord(name, null);
      console.log(`The ${name} word is out of use. Anyone holding it is signed out.`);
      return;
    }
    const word = passwordArg || (await askPassword(`Access word for ${name}s: `));
    try {
      auth.setWord(name, word);
    } catch (err) {
      return fail(err.message);
    }
    console.log(`The ${name} word is set. Anyone holding the old one is signed out.`);
    return;
  }
  if (cmd === 'remove') {
    if (!name) return fail('Which account? e.g. node tools/user.js remove krish');
    console.log(auth.removeUser(name) ? `${name} can no longer sign in.` : `No account called ${name}.`);
    return;
  }
  if (cmd === 'list') {
    const users = auth.listUsers();
    if (!users.length) console.log('No accounts yet. Add one: node tools/user.js add <name>');
    users.forEach((u) => console.log(`${u.name.padEnd(16)} ${u.role.padEnd(11)} added ${u.added}`));
    const set = auth.wordsSet();
    auth.SHARED.forEach((kind) => console.log(`${(kind + ' word').padEnd(16)} ${set[kind] ? `set ${set[kind].slice(0, 10)}` : 'not in use'}`));
    if (!users.some((u) => u.role === 'superadmin')) console.log('\nNo superadmin yet: node tools/user.js super <name>');
    return;
  }
  if (cmd === 'export') {
    const file = path.join(__dirname, '..', 'users.json');
    if (!fs.existsSync(file)) return fail('No users.json yet. Add an account first.');
    console.log(JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))));
    return;
  }
  if (cmd === 'google') {
    if (!name) return fail('Paste the client id from Google Cloud: node tools/user.js google 123....apps.googleusercontent.com');
    const conf = auth.config();
    auth.writeConfig({ googleClientId: name.trim(), allowed: conf.allowed });
    console.log('Google sign-in is on. Now allow an address: node tools/user.js allow you@example.com');
    return;
  }
  if (cmd === 'allow' || cmd === 'deny') {
    if (!name) return fail(`Which address? e.g. node tools/user.js ${cmd} krish@bookends.co.in`);
    const conf = auth.config();
    const who = name.trim().toLowerCase();
    const allowed = conf.allowed.filter((a) => a.toLowerCase() !== who);
    if (cmd === 'allow') allowed.push(who);
    auth.writeConfig({ googleClientId: conf.googleClientId, allowed });
    console.log(cmd === 'allow' ? `${who} can sign in with Google.` : `${who} can no longer sign in with Google.`);
    return;
  }
  if (cmd === 'config') {
    const conf = auth.config();
    console.log(conf.googleClientId ? `Google client id: ${conf.googleClientId}` : 'Google sign-in is off (no client id).');
    console.log(conf.allowed.length ? `Allowed: ${conf.allowed.join(', ')}` : 'Nobody is allowed yet.');
    return;
  }
  fail('Usage: node tools/user.js super|demote|add|remove|word|list|export|google|allow|deny|config [name] [secret]\n' + ROLE_NOTE);
})();

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}
